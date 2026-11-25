const express = require('express');
const { randomInt } = require('node:crypto');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');
const { GIFT_DATA } = require('../game/cases');
const { notifyAdminGift } = require('../telegram/notifications');

const router = express.Router();
router.use(requireTelegramUser, requireAgeConfirmed);

router.post('/upgrade', async (req, res) => {
  const inventoryId = String(req.body && req.body.inventoryId || '');
  const targetKey = String(req.body && req.body.targetKey || '');
  const requestId = String(req.body && req.body.requestId || '');
  if (!/^\d+$/.test(inventoryId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return res.status(400).json({ ok: false, error: 'invalid_upgrade_request' });
  }
  const target = GIFT_DATA[targetKey];
  if (!target || targetKey === 'random_nft') return res.status(400).json({ ok: false, error: 'invalid_upgrade_target' });

  const telegramId = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query(
      'SELECT success, chance, created_inventory_id FROM upgrade_events WHERE request_id = $1 AND telegram_id = $2',
      [requestId, telegramId]
    );
    if (previous.rowCount) {
      await client.query('COMMIT');
      const p = previous.rows[0];
      return res.json({ ok: true, duplicate: true, success: p.success, chance: Number(p.chance), inventoryId: p.created_inventory_id ? String(p.created_inventory_id) : null });
    }

    const source = await client.query(
      `SELECT id, item_key, value_stars FROM inventory
       WHERE id = $1 AND telegram_id = $2 AND status = 'owned' FOR UPDATE`,
      [inventoryId, telegramId]
    );
    if (!source.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'inventory_item_not_found' });
    }
    const from = source.rows[0];
    // Inventory rows may contain an older cached valuation from before the
    // gift catalogue was repriced. Use the current canonical catalogue value
    // for known gifts so the picker and server apply the same upgrade rule.
    const catalogueSource = GIFT_DATA[from.item_key];
    const fromValue = catalogueSource ? Number(catalogueSource.value) : Number(from.value_stars);
    if (!Number.isSafeInteger(fromValue) || fromValue < 1 || !Number.isSafeInteger(Number(target.value)) || Number(target.value) <= fromValue) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'invalid_upgrade_pair' });
    }
    const chance = Math.min(0.9, (fromValue / target.value) * 0.9);
    if (chance < 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'upgrade_chance_below_minimum', minimumChance: 0.01 });
    }
    const success = randomInt(0, 1000000) < Math.round(chance * 1000000);
    let createdInventoryId = null;
    if (success) {
      await client.query("UPDATE inventory SET status = 'upgraded' WHERE id = $1", [inventoryId]);
      const created = await client.query(
        `INSERT INTO inventory (telegram_id, item_key, name, emoji, rarity, value_stars, source_type, source_ref)
         VALUES ($1, $2, $3, $4, $5, $6, 'upgrade', $7) RETURNING id`,
        [telegramId, targetKey, target.name, target.emoji, target.rarity, target.value, requestId]
      );
      createdInventoryId = String(created.rows[0].id);
    } else {
      await client.query("UPDATE inventory SET status = 'burned' WHERE id = $1", [inventoryId]);
    }
    await client.query(
      `INSERT INTO upgrade_events (request_id, telegram_id, source_inventory_id, target_key, chance, success, created_inventory_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [requestId, telegramId, inventoryId, targetKey, chance, success, createdInventoryId]
    );
    await client.query('COMMIT');
    if (success) {
      notifyAdminGift({ telegramId, username: req.telegramUser.username, firstName: req.telegramUser.first_name, itemName: target.name, source: 'Успешный апгрейд', inventoryId: createdInventoryId }).catch(() => {});
    }
    res.json({ ok: true, success, chance, inventoryId: createdInventoryId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[UPGRADE ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'upgrade_failed' });
  } finally { client.release(); }
});

module.exports = router;
