const express = require('express');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');
const { GIFT_DATA } = require('../game/cases');

const router = express.Router();
router.use(requireTelegramUser);
router.use(requireAgeConfirmed);

function isAdmin(req) {
  const ids = String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  return ids.includes(String(req.telegramUser.id));
}

router.post('/admin/gifts/grant', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'admin_only' });
  const targetId = String(req.body && req.body.telegramId || '').trim();
  const itemKey = String(req.body && req.body.itemKey || '').trim();
  if (!/^\d{5,20}$/.test(targetId)) return res.status(400).json({ ok: false, error: 'invalid_telegram_id' });
  const gift = GIFT_DATA[itemKey];
  if (!gift) return res.status(400).json({ ok: false, error: 'unknown_gift' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING',
      [targetId]
    );
    const inserted = await client.query(
      `INSERT INTO inventory (telegram_id, item_key, name, emoji, rarity, value_stars)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [targetId, itemKey, gift.name, gift.emoji, gift.rarity, gift.value]
    );
    await client.query('COMMIT');
    res.json({ ok: true, inventoryId: String(inserted.rows[0].id), gift: gift.name, telegramId: targetId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ADMIN GIFT GRANT ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'gift_grant_failed' });
  } finally { client.release(); }
});

router.post('/admin/stars/grant', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'admin_only' });
  const targetId = String(req.body && req.body.telegramId || '').trim();
  const amount = Number(req.body && req.body.amount);
  const note = String(req.body && req.body.note || '').trim().slice(0, 200);
  if (!/^\\d{5,20}$/.test(targetId)) return res.status(400).json({ ok:false,error:'invalid_telegram_id' });
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) return res.status(400).json({ok:false,error:'invalid_star_amount'});
  const reference = 'admin_topup:' + require('node:crypto').randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING',[targetId]);
    await client.query(
      `INSERT INTO wallet_ledger (telegram_id,amount_stars,entry_type,reference_id)
       VALUES ($1,$2,'admin_adjustment',$3)`,
      [targetId,amount,reference]
    );
    const wallet = await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1',[targetId]);
    await client.query('COMMIT');
    res.json({ok:true,telegramId:targetId,creditedStars:amount,balance:Number(wallet.rows[0].balance),note});
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[ADMIN STAR GRANT ERROR]',error.code||error.message);
    res.status(500).json({ok:false,error:'star_grant_failed'});
  } finally { client.release(); }
});

module.exports = router;
