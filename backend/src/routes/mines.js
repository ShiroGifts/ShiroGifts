const express = require('express');
const { createHash, createHmac, randomBytes, randomUUID } = require('node:crypto');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');

const router = express.Router();
router.use(requireTelegramUser, requireAgeConfirmed);

function makeMinePositions(seed, count) {
  const cells = Array.from({ length: 25 }, (_, i) => i);
  let counter = 0;
  for (let i = cells.length - 1; i > 0; i--) {
    const digest = createHmac('sha256', seed).update(String(counter++)).digest();
    const j = digest.readUInt32BE(0) % (i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, count).sort((a, b) => a - b);
}

function minesMultiplier(mineCount, safeCount) {
  if (safeCount <= 0) return 1;
  let survival = 1;
  for (let i = 0; i < safeCount; i++) survival *= (25 - mineCount - i) / (25 - i);
  return Math.floor((0.96 / survival) * 1000000) / 1000000;
}

function publicGame(row, reveal = false) {
  const game = {
    id: String(row.id),
    betStars: Number(row.bet_stars),
    mineCount: Number(row.mine_count),
    pickedCells: (row.picked_positions || []).map(Number),
    status: row.status,
    multiplier: Number(row.multiplier),
    payoutStars: Number(row.payout_stars) || 0,
    seedHash: row.seed_hash
  };
  if (reveal && row.status !== 'active') {
    game.minePositions = (row.mine_positions || []).map(Number);
    game.serverSeed = row.server_seed;
  }
  return game;
}

async function creditPayout(client, row, multiplier) {
  const payout = Math.floor(Number(row.bet_stars) * multiplier);
  await client.query(
    "INSERT INTO wallet_ledger(telegram_id,amount_stars,entry_type,reference_id) VALUES($1,$2,'mines_payout',$3)",
    [row.telegram_id, payout, 'mines:' + row.id + ':payout']
  );
  return payout;
}

router.get('/mines/state', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM mines_games WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 1',
      [String(req.telegramUser.id)]
    );
    if (!result.rowCount) return res.json({ ok: true, game: null });
    const row = result.rows[0];
    res.json({ ok: true, game: publicGame(row, row.status !== 'active') });
  } catch (error) {
    console.error('[MINES STATE]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'mines_state_failed' });
  }
});

router.post('/mines/start', async (req, res) => {
  const betStars = Number(req.body && req.body.betStars);
  const mineCount = Number(req.body && req.body.mineCount);
  if (!Number.isSafeInteger(betStars) || betStars < 1 || betStars > 10000) {
    return res.status(400).json({ ok: false, error: 'invalid_mines_bet' });
  }
  if (!Number.isInteger(mineCount) || mineCount < 3 || mineCount > 10) {
    return res.status(400).json({ ok: false, error: 'invalid_mine_count' });
  }

  const telegramId = String(req.telegramUser.id);
  const id = randomUUID();
  const serverSeed = randomBytes(32).toString('hex');
  const seedHash = createHash('sha256').update(serverSeed).digest('hex');
  const minePositions = makeMinePositions(serverSeed, mineCount);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT telegram_id FROM users WHERE telegram_id=$1 FOR UPDATE', [telegramId]);
    const active = await client.query(
      "SELECT id FROM mines_games WHERE telegram_id=$1 AND status='active' FOR UPDATE",
      [telegramId]
    );
    if (active.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'mines_game_active' });
    }
    const balance = await client.query(
      'SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1',
      [telegramId]
    );
    if (Number(balance.rows[0].balance) < betStars) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'insufficient_balance' });
    }
    await client.query(
      'INSERT INTO mines_games(id,telegram_id,bet_stars,mine_count,mine_positions,picked_positions,server_seed,seed_hash,status,multiplier) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'active\',1)',
      [id, telegramId, betStars, mineCount, minePositions, [], serverSeed, seedHash]
    );
    await client.query(
      "INSERT INTO wallet_ledger(telegram_id,amount_stars,entry_type,reference_id) VALUES($1,$2,'mines_bet',$3)",
      [telegramId, -betStars, 'mines:' + id + ':bet']
    );
    await client.query('COMMIT');
    const game = {
      id, betStars, mineCount, pickedCells: [], status: 'active',
      multiplier: 1, payoutStars: 0, seedHash
    };
    res.json({ ok: true, game });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[MINES START]', error.code || error.message);
    res.status(error.code === '23505' ? 409 : 500).json({
      ok: false,
      error: error.code === '23505' ? 'mines_game_active' : 'mines_start_failed'
    });
  } finally { client.release(); }
});

router.post('/mines/pick', async (req, res) => {
  const id = String(req.body && req.body.gameId || '');
  const cell = Number(req.body && req.body.cell);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      !Number.isInteger(cell) || cell < 0 || cell > 24) {
    return res.status(400).json({ ok: false, error: 'invalid_mines_pick' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT * FROM mines_games WHERE id=$1 AND telegram_id=$2 FOR UPDATE',
      [id, String(req.telegramUser.id)]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'mines_game_not_found' });
    }
    const row = result.rows[0];
    const picked = (row.picked_positions || []).map(Number);
    if (row.status !== 'active' || picked.includes(cell)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'mines_cell_unavailable' });
    }
    if ((row.mine_positions || []).map(Number).includes(cell)) {
      const nextPicked = [...picked, cell];
      const updated = await client.query(
        "UPDATE mines_games SET status='lost',picked_positions=$2,ended_at=NOW() WHERE id=$1 RETURNING *",
        [id, nextPicked]
      );
      await client.query('COMMIT');
      return res.json({ ok: true, mineHit: true, game: publicGame(updated.rows[0], true) });
    }

    const nextPicked = [...picked, cell];
    const multiplier = minesMultiplier(Number(row.mine_count), nextPicked.length);
    const allSafeFound = nextPicked.length >= 25 - Number(row.mine_count);
    if (allSafeFound) {
      const payout = await creditPayout(client, row, multiplier);
      const updated = await client.query(
        "UPDATE mines_games SET status='cashed_out',picked_positions=$2,multiplier=$3,payout_stars=$4,ended_at=NOW() WHERE id=$1 RETURNING *",
        [id, nextPicked, multiplier, payout]
      );
      await client.query('COMMIT');
      return res.json({ ok: true, mineHit: false, autoCashout: true, game: publicGame(updated.rows[0], true) });
    }
    const updated = await client.query(
      'UPDATE mines_games SET picked_positions=$2,multiplier=$3 WHERE id=$1 RETURNING *',
      [id, nextPicked, multiplier]
    );
    await client.query('COMMIT');
    res.json({ ok: true, mineHit: false, game: publicGame(updated.rows[0], false) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[MINES PICK]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'mines_pick_failed' });
  } finally { client.release(); }
});

router.post('/mines/cashout', async (req, res) => {
  const id = String(req.body && req.body.gameId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ ok: false, error: 'invalid_mines_game' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT * FROM mines_games WHERE id=$1 AND telegram_id=$2 FOR UPDATE',
      [id, String(req.telegramUser.id)]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'mines_game_not_found' });
    }
    const row = result.rows[0];
    const picked = (row.picked_positions || []).map(Number);
    if (row.status !== 'active' || picked.length < 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'mines_cashout_unavailable' });
    }
    const multiplier = minesMultiplier(Number(row.mine_count), picked.length);
    const payout = await creditPayout(client, row, multiplier);
    const updated = await client.query(
      "UPDATE mines_games SET status='cashed_out',multiplier=$2,payout_stars=$3,ended_at=NOW() WHERE id=$1 RETURNING *",
      [id, multiplier, payout]
    );
    await client.query('COMMIT');
    res.json({ ok: true, game: publicGame(updated.rows[0], true) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[MINES CASHOUT]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'mines_cashout_failed' });
  } finally { client.release(); }
});

module.exports = router;
