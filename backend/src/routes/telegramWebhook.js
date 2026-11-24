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
      const pending = await pool.query(
        `SELECT telegram_id, amount_stars FROM pending_stars_invoices
         WHERE payload = $1 AND status = 'pending' AND expires_at > NOW()`,
        [q.invoice_payload || '']
      );
      const invoice = pending.rows[0];
      const valid = Boolean(invoice &&
        invoice.telegram_id === String(q.from.id) &&
        q.currency === 'XTR' &&
        Number.isSafeInteger(q.total_amount) &&
        Number(invoice.amount_stars) === q.total_amount &&
        q.total_amount >= 5 && q.total_amount <= 10000);
      await telegramApi('answerPreCheckoutQuery', {
        pre_checkout_query_id: q.id,
        ok: valid,
        ...(valid ? {} : { error_message: 'Не удалось проверить пополнение. Попробуйте ещё раз.' })
      });
    }

    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const telegramId = String(update.message.from.id);
      if (typeof payment.telegram_payment_charge_id !== 'string' ||
          !payment.telegram_payment_charge_id ||
          payment.currency !== 'XTR' ||
          !Number.isSafeInteger(payment.total_amount) ||
          payment.total_amount < 5 || payment.total_amount > 10000) {
        return res.status(400).json({ ok: false });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const existing = await client.query(
          `SELECT telegram_id, amount_stars, currency FROM star_payments
           WHERE telegram_payment_charge_id = $1`,
          [payment.telegram_payment_charge_id]
        );
        if (existing.rowCount) {
          const prior = existing.rows[0];
          const samePayment = prior.telegram_id === telegramId &&
            Number(prior.amount_stars) === payment.total_amount &&
            prior.currency === 'XTR';
          if (!samePayment) throw new Error('Payment charge ID collision');
          await client.query('COMMIT');
          return res.json({ ok: true });
        }

        const pending = await client.query(
          `SELECT telegram_id, amount_stars FROM pending_stars_invoices
           WHERE payload = $1 AND status = 'pending' AND expires_at > NOW()
           FOR UPDATE`,
          [payment.invoice_payload || '']
        );
        const invoice = pending.rows[0];
        if (!invoice || invoice.telegram_id !== telegramId ||
            Number(invoice.amount_stars) !== payment.total_amount) {
          // A concurrent retry may have committed the same charge while this request waited.
          const duplicate = await client.query(
            `SELECT telegram_id, amount_stars, currency FROM star_payments
             WHERE telegram_payment_charge_id = $1`,
            [payment.telegram_payment_charge_id]
          );
          if (duplicate.rowCount) {
            const prior = duplicate.rows[0];
            const samePayment = prior.telegram_id === telegramId &&
              Number(prior.amount_stars) === payment.total_amount &&
              prior.currency === 'XTR';
            if (samePayment) {
              await client.query('COMMIT');
              return res.json({ ok: true });
            }
          }
          throw new Error('Payment does not match a pending invoice');
        }

        await client.query(
          `INSERT INTO users (telegram_id, first_name, last_seen_at)
           VALUES ($1, $2, NOW()) ON CONFLICT (telegram_id) DO NOTHING`,
          [telegramId, update.message.from.first_name || null]
        );
        const invoiceUpdate = await client.query(
          `UPDATE pending_stars_invoices SET status = 'paid'
           WHERE payload = $1 AND status = 'pending'`,
          [payment.invoice_payload]
        );
        if (!invoiceUpdate.rowCount) throw new Error('Invoice was already processed');

        await client.query(
          `INSERT INTO star_payments (telegram_payment_charge_id, telegram_id, amount_stars, currency, status)
           VALUES ($1, $2, $3, 'XTR', 'succeeded')`,
          [payment.telegram_payment_charge_id, telegramId, payment.total_amount]
        );
        await client.query(
          `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
           VALUES ($1, $2, 'topup', $3)`,
          [telegramId, payment.total_amount, `telegram:${payment.telegram_payment_charge_id}`]
        );
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
