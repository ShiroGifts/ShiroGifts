const express = require('express');
const { pool } = require('../db/pool');
const router = express.Router();

router.post('/telegram/webhook', async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const supplied = req.header('x-telegram-bot-api-secret-token');
  if (!expected || !supplied || supplied.length !== expected.length ||
      !require('node:crypto').timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  const update = req.body || {};
  try {
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const pending = await pool.query(
        `SELECT telegram_id, amount_stars FROM pending_star_invoices
         WHERE payload = $1 AND status = 'pending' AND expires_at > NOW()`,
        [q.invoice_payload]
      );
      const valid = pending.rowCount === 1 &&
        String(pending.rows[0].telegram_id) === String(q.from.id) &&
        Number(pending.rows[0].amount_stars) === Number(q.total_amount) &&
        q.currency === 'XTR';
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pre_checkout_query_id: q.id, ok: valid, ...(valid ? {} : { error_message: 'Счёт недействителен или истёк. Создайте новый.' }) })
      });
    }

    const payment = update.message && update.message.successful_payment;
    if (payment) {
      const userId = String(update.message.from.id);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const pending = await client.query(
          `SELECT payload, telegram_id, amount_stars FROM pending_star_invoices
           WHERE payload = $1 AND status = 'pending' FOR UPDATE`,
          [payment.invoice_payload]
        );
        if (pending.rowCount === 1 &&
            String(pending.rows[0].telegram_id) === userId &&
            Number(pending.rows[0].amount_stars) === Number(payment.total_amount) &&
            payment.currency === 'XTR') {
          const chargeId = payment.telegram_payment_charge_id;
          const inserted = await client.query(
            `INSERT INTO star_payments (telegram_payment_charge_id, telegram_id, amount_stars, currency)
             VALUES ($1, $2, $3, 'XTR') ON CONFLICT (telegram_payment_charge_id) DO NOTHING RETURNING telegram_payment_charge_id`,
            [chargeId, userId, payment.total_amount]
          );
          if (inserted.rowCount) {
            await client.query(
              `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
               VALUES ($1, $2, 'topup', $3)`,
              [userId, payment.total_amount, chargeId]
            );
          }
          await client.query(
            `UPDATE pending_star_invoices SET status = 'paid', paid_at = NOW()
             WHERE payload = $1 AND status = 'pending'`,
            [payment.invoice_payload]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('[TELEGRAM WEBHOOK ERROR]', error.code || error.message);
    res.sendStatus(500);
  }
});

module.exports = router;
