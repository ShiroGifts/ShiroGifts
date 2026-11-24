const express = require('express');
const { pool } = require('../db/pool');
const { requireTelegramUser } = require('../telegram/auth');
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
    res.json({
      ok: true,
      user: { id, firstName: req.telegramUser.first_name || '', username: req.telegramUser.username || null },
      balance: Number(wallet.rows[0].balance),
      inventory: items.rows
    });
  } catch (error) {
    console.error('[ACCOUNT ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'account_load_failed' });
  } finally { client.release(); }
});

router.post('/payments/invoice', async (req, res) => {
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
