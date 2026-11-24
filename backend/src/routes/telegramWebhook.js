const express = require('express');
const { pool } = require('../db/pool');
const { telegramApi } = require('./payments');
const router = express.Router();

router.post('/webhook', async (req, res) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = req.header('x-telegram-bot-api-secret-token');
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return res.status(401).json({ ok: false });
  }

  const update = req.body || {};
  try {
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const match = /^topup:(\d+):[a-f0-9-]{36}$/.exec(q.invoice_payload || '');
      const valid = Boolean(match && match[1] === String(q.from.id) && q.currency === 'XTR' && Number.isSafeInteger(q.total_amount) && q.total_amount >= 5 && q.total_amount <= 10000);
      await telegramApi('answerPreCheckoutQuery', {
        pre_checkout_query_id: q.id,
        ok: valid,
        ...(valid ? {} : { error_message: 'Не удалось проверить пополнение. Попробуйте ещё раз.' })
      });
    }

    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const telegramId = String(update.message.from.id);
      const match = /^topup:(\d+):[a-f0-9-]{36}$/.exec(payment.invoice_payload || '');
      if (!match || match[1] !== telegramId || payment.currency !== 'XTR' || !Number.isSafeInteger(payment.total_amount) || payment.total_amount < 5) {
        console.error('[STARS PAYMENT] Rejected invalid payment payload');
        return res.status(400).json({ ok: false });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO users (telegram_id, first_name, last_seen_at)
           VALUES ($1, $2, NOW()) ON CONFLICT (telegram_id) DO NOTHING`,
          [telegramId, update.message.from.first_name || null]
        );
        const inserted = await client.query(
          `INSERT INTO star_payments (telegram_payment_charge_id, telegram_id, amount_stars, currency, status)
           VALUES ($1, $2, $3, 'XTR', 'succeeded')
           ON CONFLICT (telegram_payment_charge_id) DO NOTHING
           RETURNING telegram_payment_charge_id`,
          [payment.telegram_payment_charge_id, telegramId, payment.total_amount]
        );
        if (inserted.rowCount) {
          await client.query(
            `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
             VALUES ($1, $2, 'topup', $3)`,
            [telegramId, payment.total_amount, `telegram:${payment.telegram_payment_charge_id}`]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('[TELEGRAM WEBHOOK ERROR]', error.code || error.message);
    return res.status(500).json({ ok: false });
  }
});

module.exports = router;
