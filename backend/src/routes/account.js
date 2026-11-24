const express = require('express');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');
const router = express.Router();

router.use(requireTelegramUser);

router.get('/me', async (req, res) => {
  const id = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    const wallet = await client.query(
      'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [id]
    );
    const items = await client.query(
      `SELECT id, item_key, name, emoji, rarity, value_stars, status, created_at
       FROM inventory WHERE telegram_id = $1 AND status = 'owned' ORDER BY created_at DESC`,
      [id]
    );
    const profile = await client.query('SELECT age_confirmed_at FROM users WHERE telegram_id = $1', [id]);
    const referrals = await client.query('SELECT COUNT(*)::int AS count FROM referrals WHERE referrer_telegram_id = $1', [id]);
    res.json({
      ok: true,
      user: { id, firstName: req.telegramUser.first_name || '', username: req.telegramUser.username || null },
      ageConfirmed: !!profile.rows[0]?.age_confirmed_at,
      referralsCount: Number(referrals.rows[0].count) || 0,
      balance: Number(wallet.rows[0].balance),
      inventory: items.rows
    });
  } catch (error) {
    console.error('[ACCOUNT ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'account_load_failed' });
  } finally { client.release(); }
});


function hasBotNameTag(user) {
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return /@shirogiftsbot\\b/i.test(displayName);
}

router.get('/daily-name-reward/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT last_claimed_at FROM daily_name_rewards WHERE telegram_id = $1', [String(req.telegramUser.id)]);
    const lastClaimedAt = result.rows[0]?.last_claimed_at ? new Date(result.rows[0].last_claimed_at) : null;
    const nextClaimAt = lastClaimedAt ? new Date(lastClaimedAt.getTime() + 24 * 60 * 60 * 1000) : null;
    res.json({
      ok: true,
      hasTag: hasBotNameTag(req.telegramUser),
      canClaim: hasBotNameTag(req.telegramUser) && (!nextClaimAt || nextClaimAt.getTime() <= Date.now()),
      nextClaimAt: nextClaimAt ? nextClaimAt.toISOString() : null
    });
  } catch (error) {
    console.error('[DAILY NAME STATUS ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'daily_reward_status_failed' });
  }
});

router.post('/daily-name-reward/claim', async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  if (!hasBotNameTag(req.telegramUser)) {
    return res.status(400).json({ ok: false, error: 'daily_name_tag_required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);
    const current = await client.query('SELECT last_claimed_at FROM daily_name_rewards WHERE telegram_id = $1 FOR UPDATE', [telegramId]);
    const lastClaimedAt = current.rows[0]?.last_claimed_at ? new Date(current.rows[0].last_claimed_at) : null;
    const nextClaimAt = lastClaimedAt ? new Date(lastClaimedAt.getTime() + 24 * 60 * 60 * 1000) : null;
    if (nextClaimAt && nextClaimAt.getTime() > Date.now()) {
      await client.query('ROLLBACK');
      return res.status(429).json({ ok: false, error: 'daily_reward_cooldown', nextClaimAt: nextClaimAt.toISOString() });
    }
    await client.query(
      "INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id) VALUES ($1, 25, 'daily_reward', $2)",
      [telegramId, 'daily-name:' + telegramId + ':' + Date.now()]
    );
    await client.query(
      'INSERT INTO daily_name_rewards (telegram_id, last_claimed_at) VALUES ($1, NOW()) ON CONFLICT (telegram_id) DO UPDATE SET last_claimed_at = EXCLUDED.last_claimed_at',
      [telegramId]
    );
    const wallet = await client.query('SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1', [telegramId]);
    const claimed = await client.query('SELECT last_claimed_at FROM daily_name_rewards WHERE telegram_id = $1', [telegramId]);
    await client.query('COMMIT');
    res.json({ ok: true, amount: 25, balance: Number(wallet.rows[0].balance), nextClaimAt: new Date(new Date(claimed.rows[0].last_claimed_at).getTime() + 24 * 60 * 60 * 1000).toISOString() });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[DAILY NAME CLAIM ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'daily_reward_claim_failed' });
  } finally { client.release(); }
});

router.post('/age/confirm', async (req, res) => {
  if (!req.body || req.body.confirmed !== true) {
    return res.status(400).json({ ok: false, error: 'age_confirmation_required' });
  }
  try {
    await pool.query(
      'UPDATE users SET age_confirmed_at = COALESCE(age_confirmed_at, NOW()) WHERE telegram_id = $1',
      [String(req.telegramUser.id)]
    );
    res.json({ ok: true, ageConfirmed: true });
  } catch (error) {
    console.error('[AGE CONFIRM ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'age_confirmation_failed' });
  }
});

router.post('/payments/invoice', requireAgeConfirmed, async (req, res) => {
  const amount = Number(req.body && req.body.amount);
  if (!Number.isSafeInteger(amount) || amount < 5 || amount > 10000) {
    return res.status(400).json({ ok: false, error: 'amount_must_be_5_to_10000' });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'payments_not_configured' });
  const id = String(req.telegramUser.id);
  const payload = 'sg_topup_' + require('node:crypto').randomUUID();
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO pending_star_invoices (payload, telegram_id, amount_stars, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')`,
      [payload, id, amount]
    );
    const response = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Пополнение ShiroGifts',
        description: `Пополнение баланса на ${amount} Stars`,
        payload, provider_token: '', currency: 'XTR',
        prices: [{ label: 'Stars', amount }]
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok || !data.result) throw new Error(data.description || 'Telegram invoice creation failed');
    res.json({ ok: true, invoiceUrl: data.result });
  } catch (error) {
    await client.query('DELETE FROM pending_star_invoices WHERE payload = $1 AND status = \'pending\'', [payload]).catch(() => {});
    console.error('[INVOICE ERROR]', error.message);
    res.status(502).json({ ok: false, error: 'invoice_creation_failed' });
  } finally { client.release(); }
});

module.exports = router;
