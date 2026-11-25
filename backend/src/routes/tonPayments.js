const express = require('express');
const { randomUUID, randomInt } = require('node:crypto');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');

const router = express.Router();
router.use(requireTelegramUser);
router.use(requireAgeConfirmed);

const STARS_PER_TON = 100;
const WALLET_ADDRESS = String(process.env.TON_WALLET_ADDRESS || '').trim();
const TONCENTER = 'https://toncenter.com/api/v2/getTransactions';

function validRawAddress(value) {
  return /^-?\d:[0-9a-f]{64}$/i.test(String(value || ''));
}
function normalizeTonAddress(value) {
  const address = String(value || '').trim();
  if (/^-?\\d:[0-9a-f]{64}$/i.test(address)) return address.toLowerCase();
  try {
    const bytes = Buffer.from(address.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (bytes.length === 36) return bytes.readInt8(1) + ':' + bytes.subarray(2, 34).toString('hex');
  } catch (_) {}
  return address.toLowerCase();
}

router.get('/ton/config', (_req, res) => {
  if (!WALLET_ADDRESS) return res.status(503).json({ ok: false, error: 'ton_payments_not_configured' });
  res.json({ ok: true, walletAddress: WALLET_ADDRESS, starsPerTon: STARS_PER_TON });
});

router.post('/ton/intent', async (req, res) => {
  if (!WALLET_ADDRESS) return res.status(503).json({ ok: false, error: 'ton_payments_not_configured' });
  const amountStars = Number(req.body && req.body.amountStars);
  const senderAddress = String(req.body && req.body.senderAddress || '').trim();
  if (!Number.isSafeInteger(amountStars) || amountStars < 5 || amountStars > 10000) {
    return res.status(400).json({ ok: false, error: 'amount_must_be_5_to_10000' });
  }
  if (!validRawAddress(senderAddress)) return res.status(400).json({ ok: false, error: 'invalid_wallet_address' });
  const id = randomUUID();
  // A tiny unique nanoTON suffix lets the server identify the exact transfer
  // without trusting a client-provided transaction hash or a memo.
  const amountNanotons = BigInt(amountStars) * 10000000n + BigInt(randomInt(1, 999999));
  try {
    await pool.query(
      `INSERT INTO pending_ton_payments
       (id, telegram_id, sender_address, amount_stars, amount_nanotons, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 minutes')`,
      [id, String(req.telegramUser.id), senderAddress, amountStars, amountNanotons.toString()]
    );
    res.json({
      ok: true, intentId: id, amountStars,
      amountNanotons: amountNanotons.toString(),
      amountTon: Number(amountNanotons) / 1e9,
      walletAddress: WALLET_ADDRESS,
      expiresIn: 1800
    });
  } catch (error) {
    console.error('[TON INTENT ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'ton_intent_failed' });
  }
});

router.post('/ton/verify', async (req, res) => {
  const intentId = String(req.body && req.body.intentId || '');
  if (!/^[0-9a-f-]{36}$/i.test(intentId)) return res.status(400).json({ ok: false, error: 'invalid_intent' });
  const telegramId = String(req.telegramUser.id);
  let intent;
  try {
    const found = await pool.query(
      `SELECT id, sender_address, amount_stars, amount_nanotons, status, tx_hash, expires_at, created_at
       FROM pending_ton_payments WHERE id = $1 AND telegram_id = $2`,
      [intentId, telegramId]
    );
    if (!found.rowCount) return res.status(404).json({ ok: false, error: 'ton_intent_not_found' });
    intent = found.rows[0];
    if (intent.status === 'paid') {
      const wallet = await pool.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1', [telegramId]);
      return res.json({ ok: true, status: 'paid', balance: Number(wallet.rows[0].balance), amountStars: Number(intent.amount_stars) });
    }
    if (new Date(intent.expires_at).getTime() <= Date.now()) {
      await pool.query("UPDATE pending_ton_payments SET status='expired' WHERE id=$1 AND status='pending'", [intentId]);
      return res.json({ ok: true, status: 'expired' });
    }

    const url = new URL(TONCENTER);
    url.searchParams.set('address', WALLET_ADDRESS);
    url.searchParams.set('limit', '100');
    const headers = {};
    if (process.env.TONCENTER_API_KEY) headers['X-API-Key'] = process.env.TONCENTER_API_KEY;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.result)) throw new Error(data.error || 'TON blockchain lookup failed');
    const minTime = Math.floor(new Date(intent.created_at).getTime() / 1000) - 30;
    const expected = BigInt(intent.amount_nanotons).toString();
    const match = data.result.find(tx => {
      const msg = tx && tx.in_msg;
      return msg &&
        normalizeTonAddress(msg.source) === normalizeTonAddress(intent.sender_address) &&
        normalizeTonAddress(msg.destination) === normalizeTonAddress(WALLET_ADDRESS) &&
        String(msg.value || '') === expected &&
        Number(tx.utime || 0) >= minTime &&
        tx.transaction_id && tx.transaction_id.hash;
    });
    if (!match) return res.json({ ok: true, status: 'pending' });

    const txHash = String(match.transaction_id.hash);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT amount_stars, status, tx_hash FROM pending_ton_payments WHERE id=$1 AND telegram_id=$2 FOR UPDATE',
        [intentId, telegramId]
      );
      if (!locked.rowCount) throw new Error('TON intent disappeared');
      if (locked.rows[0].status === 'paid') {
        const wallet = await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1', [telegramId]);
        await client.query('COMMIT');
        return res.json({ ok: true, status: 'paid', balance: Number(wallet.rows[0].balance), amountStars: Number(locked.rows[0].amount_stars) });
      }
      const updated = await client.query(
        "UPDATE pending_ton_payments SET status='paid', tx_hash=$2, paid_at=NOW() WHERE id=$1 AND status='pending' AND tx_hash IS NULL RETURNING amount_stars",
        [intentId, txHash]
      );
      if (!updated.rowCount) throw new Error('TON transaction already used or intent is not pending');
      await client.query(
        `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
         VALUES ($1, $2, 'topup', $3)`,
        [telegramId, Number(updated.rows[0].amount_stars), 'ton:' + txHash]
      );
      const wallet = await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1', [telegramId]);
      await client.query('COMMIT');
      return res.json({ ok: true, status: 'paid', balance: Number(wallet.rows[0].balance), amountStars: Number(updated.rows[0].amount_stars) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return res.status(409).json({ ok: false, error: 'ton_transaction_already_used' });
      throw error;
    } finally { client.release(); }
  } catch (error) {
    console.error('[TON VERIFY ERROR]', error.code || error.message);
    res.status(502).json({ ok: false, error: 'ton_verification_unavailable' });
  }
});

module.exports = router;
