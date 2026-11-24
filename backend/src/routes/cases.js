const express = require('express');
const { randomUUID } = require('node:crypto');
const { pool } = require('../db/pool');
const { requireTelegramUser } = require('../telegram/auth');
const { getCase, pickDrop, GIFT_DATA } = require('../game/cases');

const router = express.Router();
router.use(requireTelegramUser);

router.post('/cases/open', async (req, res) => {
  const caseId = String(req.body && req.body.caseId || '');
  const requestId = String(req.body && req.body.requestId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return res.status(400).json({ ok: false, error: 'invalid_request_id' });
  }
  const selectedCase = getCase(caseId);
  if (!selectedCase) return res.status(404).json({ ok: false, error: 'case_not_found' });

  const telegramId = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);

    const previous = await client.query(
      'SELECT case_id, reward_type, reward_key, reward_stars, inventory_id FROM case_openings WHERE request_id = $1 AND telegram_id = $2',
      [requestId, telegramId]
    );
    if (previous.rowCount) {
      const wallet = await client.query(
        'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
        [telegramId]
      );
      await client.query('COMMIT');
      const p = previous.rows[0];
      return res.json({
        ok: true, duplicate: true, balance: Number(wallet.rows[0].balance),
        reward: p.reward_type === 'stars'
          ? { type: 'stars', amount: Number(p.reward_stars) }
          : { type: 'gift', key: p.reward_key, inventoryId: p.inventory_id ? String(p.inventory_id) : null }
      });
    }

    const wallet = await client.query(
      'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [telegramId]
    );
    const balance = Number(wallet.rows[0].balance);
    if (balance < selectedCase.price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'insufficient_balance', balance });
    }

    const drop = pickDrop(selectedCase.drops);
    const spendRef = 'case:' + requestId + ':spend';
    await client.query(
      `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
       VALUES ($1, $2, 'case_spend', $3)`,
      [telegramId, -selectedCase.price, spendRef]
    );

    let reward;
    let inventoryId = null;
    if (drop.type === 'stars') {
      const rewardRef = 'case:' + requestId + ':reward';
      await client.query(
        `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
         VALUES ($1, $2, 'case_reward', $3)`,
        [telegramId, drop.amount, rewardRef]
      );
      reward = { type: 'stars', amount: drop.amount };
    } else {
      const gift = GIFT_DATA[drop.key];
      if (!gift) throw new Error('Unknown gift in case catalog');
      const inserted = await client.query(
        `INSERT INTO inventory (telegram_id, item_key, name, emoji, rarity, value_stars)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [telegramId, drop.key, gift.name, gift.emoji, gift.rarity, gift.value]
      );
      inventoryId = String(inserted.rows[0].id);
      reward = { type: 'gift', key: drop.key, inventoryId };
    }

    await client.query(
      `INSERT INTO case_openings
       (request_id, telegram_id, case_id, case_price, reward_type, reward_key, reward_stars, inventory_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [requestId, telegramId, selectedCase.id, selectedCase.price,
       drop.type, drop.type === 'gift' ? drop.key : null,
       drop.type === 'stars' ? drop.amount : null, inventoryId]
    );

    const newWallet = await client.query(
      'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [telegramId]
    );
    await client.query('COMMIT');
    res.json({ ok: true, balance: Number(newWallet.rows[0].balance), reward });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CASE OPEN ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'case_open_failed' });
  } finally { client.release(); }
});

module.exports = router;
