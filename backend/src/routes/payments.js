const express = require('express');
const crypto = require('node:crypto');
const { telegramUserFromRequest } = require('../telegram/auth');
const { pool } = require('../db/pool');
const router = express.Router();

async function telegramApi(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API ${method} failed`);
  return data.result;
}

router.post('/invoice', async (req, res) => {
  const user = telegramUserFromRequest(req);
  if (!user) return res.status(401).json({ ok: false, error: 'invalid_telegram_init_data' });
  const amount = Number(req.body?.amount);
  if (!Number.isSafeInteger(amount) || amount < 5 || amount > 10000) {
    return res.status(400).json({ ok: false, error: 'amount_must_be_between_5_and_10000_stars' });
  }
  try {
    const payload = `topup:${user.id}:${crypto.randomUUID()}`;
    await pool.query(
      'INSERT INTO pending_stars_invoices (payload, telegram_id, amount_stars) VALUES ($1, $2, $3)',
      [payload, String(user.id), amount]
    );
    let invoiceUrl;
    try {
      invoiceUrl = await telegramApi('createInvoiceLink', {
      title: 'Пополнение ShiroGifts',
      description: `Пополнение баланса на ${amount} Telegram Stars`,
      payload,
      currency: 'XTR',
      prices: [{ label: 'Пополнение баланса', amount }]
      });
    } catch (error) {
      await pool.query('DELETE FROM pending_stars_invoices WHERE payload = $1', [payload]).catch(() => {});
      throw error;
    }
    return res.json({ ok: true, invoice_url: invoiceUrl });
  } catch (error) {
    console.error('[STARS INVOICE ERROR]', error.message);
    return res.status(503).json({ ok: false, error: 'invoice_unavailable' });
  }
});

module.exports = { router, telegramApi };
