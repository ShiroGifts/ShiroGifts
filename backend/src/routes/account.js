const express = require('express');
const { pool } = require('../db/pool');
const { telegramUserFromRequest } = require('../telegram/auth');
const router = express.Router();

router.get('/me', async (req, res) => {
  const telegramUser = telegramUserFromRequest(req);
  if (!telegramUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_init_data' });
  try {
    await pool.query(
      `INSERT INTO users (telegram_id, username, first_name, last_seen_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (telegram_id) DO UPDATE
       SET username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           last_seen_at = NOW()`,
      [String(telegramUser.id), telegramUser.username || null, telegramUser.first_name || null]
    );
    const [wallet, items] = await Promise.all([
      pool.query(
        'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
        [String(telegramUser.id)]
      ),
      pool.query(
        `SELECT id, gift_key, status, created_at
         FROM inventory_items WHERE telegram_id = $1 AND status = 'owned'
         ORDER BY id DESC`,
        [String(telegramUser.id)]
      )
    ]);
    return res.json({
      ok: true,
      user: { id: String(telegramUser.id), first_name: telegramUser.first_name || '' },
      balance: Number(wallet.rows[0].balance),
      inventory: items.rows
    });
  } catch (error) {
    console.error('[ACCOUNT LOAD ERROR]', error.code || error.message);
    return res.status(503).json({ ok: false, error: 'account_unavailable' });
  }
});

module.exports = router;
