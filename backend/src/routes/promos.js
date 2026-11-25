const express = require('express');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');

const router = express.Router();
router.use(requireTelegramUser);
router.use(requireAgeConfirmed);

function adminIds() {
  return new Set(String(process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
}
function isAdmin(req) {
  return adminIds().has(String(req.telegramUser.id)) || String(req.telegramUser.id) === '8159031701';
}

router.get('/promos/admin/status', (req, res) => {
  res.json({ ok: true, isAdmin: isAdmin(req) });
});

router.post('/promos/redeem', async (req, res) => {
  const code = String(req.body && req.body.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return res.status(400).json({ ok: false, error: 'invalid_promo_code' });
  }
  const telegramId = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT id, reward_stars, usage_limit, uses_count, active, expires_at FROM promo_codes WHERE code = $1 FOR UPDATE',
      [code]
    );
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'promo_not_found' });
    }
    const promo = found.rows[0];
    if (!promo.active || (promo.expires_at && new Date(promo.expires_at).getTime() <= Date.now())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'promo_expired' });
    }
    if (promo.usage_limit !== null && Number(promo.uses_count) >= Number(promo.usage_limit)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'promo_limit_reached' });
    }
    const already = await client.query(
      'SELECT 1 FROM promo_redemptions WHERE promo_id = $1 AND telegram_id = $2',
      [promo.id, telegramId]
    );
    if (already.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'promo_already_used' });
    }

    const reward = Number(promo.reward_stars);
    await client.query(
      'INSERT INTO promo_redemptions (promo_id, telegram_id, reward_stars) VALUES ($1, $2, $3)',
      [promo.id, telegramId, reward]
    );
    await client.query('UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = $1', [promo.id]);
    await client.query(
      `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
       VALUES ($1, $2, 'admin_adjustment', $3)`,
      [telegramId, reward, `promo:${promo.id}:${telegramId}`]
    );
    const wallet = await client.query(
      'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [telegramId]
    );
    await client.query('COMMIT');
    res.json({ ok: true, rewardStars: reward, balance: Number(wallet.rows[0].balance) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PROMO REDEEM ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'promo_redeem_failed' });
  } finally {
    client.release();
  }
});

router.post('/promos/admin/create', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'admin_only' });
  const code = String(req.body && req.body.code || '').trim().toUpperCase();
  const reward = Number(req.body && req.body.rewardStars);
  const usageLimitRaw = req.body && req.body.usageLimit;
  const usageLimit = usageLimitRaw === '' || usageLimitRaw === null || usageLimitRaw === undefined
    ? null : Number(usageLimitRaw);
  const expiresAtRaw = req.body && req.body.expiresAt;
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return res.status(400).json({ ok: false, error: 'invalid_promo_code' });
  }
  if (!Number.isSafeInteger(reward) || reward < 1 || reward > 100000) {
    return res.status(400).json({ ok: false, error: 'invalid_reward_amount' });
  }
  if (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1 || usageLimit > 1000000)) {
    return res.status(400).json({ ok: false, error: 'invalid_usage_limit' });
  }
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
    return res.status(400).json({ ok: false, error: 'invalid_expiry' });
  }
  try {
    const created = await pool.query(
      `INSERT INTO promo_codes (code, reward_stars, usage_limit, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING code, reward_stars, usage_limit, expires_at`,
      [code, reward, usageLimit, expiresAt, String(req.telegramUser.id)]
    );
    res.json({ ok: true, promo: created.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ ok: false, error: 'promo_code_exists' });
    console.error('[PROMO CREATE ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'promo_create_failed' });
  }
});

module.exports = router;
