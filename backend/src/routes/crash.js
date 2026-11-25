const express = require('express');
const { randomBytes, createHash, createHmac } = require('node:crypto');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');
const { GIFT_DATA } = require('../game/cases');

const router = express.Router();
router.use(requireTelegramUser, requireAgeConfirmed);
const BET_WINDOW_MS = 6000;
const RESULT_PAUSE_MS = 3500;
const GROWTH_K = 0.15;
const multiplierAt = ms => Math.exp(GROWTH_K * Math.max(0, ms) / 1000);
const timeToCrash = mult => Math.log(Math.max(1, Number(mult))) / GROWTH_K * 1000;
let engineClient = null;
let tickBusy = false;
let engineTimer = null;
let retryTimer = null;
let acquiring = false;

function crashPoint(seed, clientSeed, nonce) {
  const digest = createHmac('sha256', seed).update(clientSeed + ':' + nonce).digest();
  const n = digest.readUIntBE(0, 6) / 0x1000000000000;
  return Math.max(1, Math.min(50, Math.floor((0.96 / Math.max(1e-12, 1 - n)) * 100) / 100));
}
async function createScheduledRound() {
  const seed = randomBytes(32).toString('hex');
  const clientSeed = randomBytes(16).toString('hex');
  const nonce = Date.now();
  const point = crashPoint(seed, clientSeed, nonce);
  const hash = createHash('sha256').update(seed).digest('hex');
  await pool.query(
    `INSERT INTO crash_rounds (status, server_seed, server_seed_hash, client_seed, nonce, crash_multiplier, starts_at)
     VALUES ('scheduled',$1,$2,$3,$4,$5,NOW() + INTERVAL '6 seconds')`,
    [seed, hash, clientSeed, nonce, point]
  );
}

async function engineTick() {
  if (tickBusy || !engineClient) return;
  tickBusy = true;
  try {
    let q = await pool.query(`SELECT * FROM crash_rounds WHERE status IN ('scheduled','running','crashed') ORDER BY id DESC LIMIT 1`);
    if (!q.rowCount) { await createScheduledRound(); return; }
    const r = q.rows[0];
    const now = Date.now();
    if (r.status === 'scheduled') {
      const startAt = r.starts_at ? new Date(r.starts_at).getTime() : now;
      if (now >= startAt) {
        await pool.query(`UPDATE crash_rounds SET status='running', started_at=NOW() WHERE id=$1 AND status='scheduled'`, [r.id]);
      }
    } else if (r.status === 'running') {
      const elapsed = now - new Date(r.started_at).getTime();
      if (elapsed >= timeToCrash(r.crash_multiplier)) {
        const seed = r.server_seed || '';
        await pool.query(
          `UPDATE crash_rounds SET status='crashed', server_seed_revealed=$2, ended_at=NOW()
           WHERE id=$1 AND status='running'`,
          [r.id, seed || null]
        );
      }
    } else if (r.status === 'crashed') {
      await pool.query(`UPDATE inventory i SET status='burned' FROM crash_bets b WHERE b.round_id=$1 AND b.source_inventory_id=i.id AND b.cashout_multiplier IS NULL AND i.status='crash_locked'`, [r.id]);
      if (now - new Date(r.ended_at).getTime() >= RESULT_PAUSE_MS) {
        await pool.query(`UPDATE crash_rounds SET status='settled' WHERE id=$1 AND status='crashed'`, [r.id]);
        await createScheduledRound();
      }
    }
  } catch (error) {
    console.error('[CRASH ENGINE ERROR]', error.code || error.message);
  } finally { tickBusy = false; }
}
async function acquireCrashEngine() {
  if (engineClient || acquiring) return !!engineClient;
  acquiring = true;
  let client;
  try {
    client = await pool.connect();
    const lock = await client.query('SELECT pg_try_advisory_lock(731902, 2026) AS locked');
    if (!lock.rows[0].locked) {
      client.release();
      console.log('[CRASH] Waiting for previous instance to release the round lock');
      return false;
    }
    engineClient = client;
    // Resume the persisted round after a restart; its server-side start time and crash point remain authoritative.
    await engineTick();
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    engineTimer = setInterval(engineTick, 250);
    console.log('[CRASH] Server-authoritative round engine started');
    return true;
  } catch (error) {
    if (client && client !== engineClient) client.release();
    console.error('[CRASH ENGINE LOCK ERROR]', error.code || error.message);
    return false;
  } finally { acquiring = false; }
}
async function startCrashEngine() {
  if (engineTimer || retryTimer) return;
  const acquired = await acquireCrashEngine();
  if (!acquired) retryTimer = setInterval(() => { acquireCrashEngine().catch(error => console.error('[CRASH RETRY]', error.message)); }, 1000);
}

router.get('/crash/state', async (req, res) => {
  try {
    const roundResult = await pool.query(`SELECT id,status,starts_at,started_at,crash_multiplier,server_seed_hash,server_seed_revealed,client_seed,nonce
      FROM crash_rounds ORDER BY id DESC LIMIT 1`);
    if (!roundResult.rowCount) return res.status(503).json({ok:false,error:'crash_not_ready'});
    const r = roundResult.rows[0];
    const isCrashed = r.status === 'crashed' || r.status === 'settled';
    const phase = r.status === 'scheduled' ? 'betting' : r.status === 'running' ? 'flying' : 'crashed';
    const userId = String(req.telegramUser.id);
    const [mine, bets, history] = await Promise.all([
      pool.query('SELECT id,stake_stars,cashout_multiplier,payout_stars FROM crash_bets WHERE round_id=$1 AND telegram_id=$2', [r.id,userId]),
      pool.query(`SELECT b.id,b.telegram_id,b.stake_stars,b.cashout_multiplier,b.payout_stars,b.source_inventory_id,b.cashout_inventory_id,u.first_name,
        src.item_key AS gift_key,src.emoji AS gift_emoji,dst.item_key AS cashout_gift_key
        FROM crash_bets b LEFT JOIN users u ON u.telegram_id=b.telegram_id
        LEFT JOIN inventory src ON src.id=b.source_inventory_id
        LEFT JOIN inventory dst ON dst.id=b.cashout_inventory_id
        WHERE b.round_id=$1 ORDER BY b.created_at DESC LIMIT 12`, [r.id]),
      pool.query(`SELECT crash_multiplier FROM crash_rounds WHERE status IN ('crashed','settled') ORDER BY id DESC LIMIT 12`)
    ]);
    const b = mine.rows[0];
    const ownBet = b ? {id:String(b.id),amount:Number(b.stake_stars),cashed:b.cashout_multiplier==null?null:Number(b.cashout_multiplier),payout:b.payout_stars==null?null:Number(b.payout_stars)} : null;
    const serverTime = Date.now();
    const currentMult = r.status === 'running' ? multiplierAt(serverTime - new Date(r.started_at).getTime()) : 1;
    res.json({ok:true,serverTime,round:{id:String(r.id),phase,startsAt:r.starts_at?new Date(r.starts_at).getTime():null,startedAt:r.started_at?new Date(r.started_at).getTime():null,crashMult:isCrashed?Number(r.crash_multiplier):null,currentMult},
      myBet:ownBet,history:history.rows.map(x=>Number(x.crash_multiplier)).filter(Number.isFinite),
      bets:bets.rows.map(x=>({id:String(x.id),name:x.first_name||'Игрок',bet:Number(x.stake_stars),giftKey:x.gift_key||null,giftEmoji:x.gift_emoji||null,cashoutGiftKey:x.cashout_gift_key||null,mult:x.cashout_multiplier==null?null:Number(x.cashout_multiplier),win:x.payout_stars==null?0:Number(x.payout_stars),crashed:x.cashout_multiplier==null&&r.status==='crashed'})),
      fairness:{serverSeedHash:r.server_seed_hash,revealedSeed:isCrashed?r.server_seed_revealed:null,clientSeed:isCrashed?r.client_seed:null,nonce:isCrashed?Number(r.nonce):null}});
  } catch(error) { console.error('[CRASH STATE]',error.code||error.message); res.status(500).json({ok:false,error:'crash_state_failed'}); }
});

router.post('/crash/bet', async (req,res) => {
  const inventoryId = String(req.body && req.body.inventoryId || '');
  const itemMode = /^\d+$/.test(inventoryId);
  const amount=Number(req.body&&req.body.amount);
  if(!itemMode && (!Number.isSafeInteger(amount)||amount<1||amount>10000)) return res.status(400).json({ok:false,error:'invalid_bet_amount'});
  const telegramId=String(req.telegramUser.id), client=await pool.connect();
  try {
    await client.query('BEGIN');
    const round=await client.query(`SELECT id,status,starts_at FROM crash_rounds WHERE status='scheduled' ORDER BY id DESC LIMIT 1 FOR UPDATE`);
    if(!round.rowCount||new Date(round.rows[0].starts_at).getTime()<=Date.now()){await client.query('ROLLBACK');return res.status(409).json({ok:false,error:'betting_closed'});}
    await client.query('SELECT telegram_id FROM users WHERE telegram_id=$1 FOR UPDATE',[telegramId]);
    let sourceInventoryId = null, stake = amount;
    if (itemMode) {
      const item = await client.query("SELECT id,value_stars FROM inventory WHERE id=$1 AND telegram_id=$2 AND status='owned' FOR UPDATE",[inventoryId,telegramId]);
      if (!item.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ok:false,error:'crash_item_not_found'}); }
      sourceInventoryId = item.rows[0].id; stake = Number(item.rows[0].value_stars);
      if (!Number.isSafeInteger(stake) || stake < 1) { await client.query('ROLLBACK'); return res.status(400).json({ok:false,error:'invalid_crash_item'}); }
      await client.query("UPDATE inventory SET status='crash_locked' WHERE id=$1",[sourceInventoryId]);
    } else {
      const balance=await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1',[telegramId]);
      if(Number(balance.rows[0].balance)<amount){await client.query('ROLLBACK');return res.status(400).json({ok:false,error:'insufficient_balance'});}
      const ref='crash:'+round.rows[0].id+':bet:'+telegramId;
      await client.query(`INSERT INTO wallet_ledger(telegram_id,amount_stars,entry_type,reference_id) VALUES($1,$2,'crash_bet',$3)`,[telegramId,-amount,ref]);
    }
    const wagerCurrency = sourceInventoryId ? 'NFT' : (req.body && req.body.currency === 'TON' ? 'TON' : 'STARS');
    await client.query('INSERT INTO crash_bets(round_id,telegram_id,stake_stars,source_inventory_id,wager_currency) VALUES($1,$2,$3,$4,$5)',[round.rows[0].id,telegramId,stake,sourceInventoryId,wagerCurrency]);
    await client.query('COMMIT');
    res.json({ok:true,amount,roundId:String(round.rows[0].id)});
  } catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('[CRASH BET]',error.code||error.message);res.status(error.code==='23505'?409:500).json({ok:false,error:error.code==='23505'?'bet_already_placed':'crash_bet_failed'});}
  finally{client.release();}
});

router.post('/crash/cashout', async(req,res)=>{
  const telegramId=String(req.telegramUser.id),client=await pool.connect();
  try{
    await client.query('BEGIN');
    const round=await client.query(`SELECT id,status,started_at,crash_multiplier FROM crash_rounds WHERE status='running' ORDER BY id DESC LIMIT 1 FOR UPDATE`);
    if(!round.rowCount){await client.query('ROLLBACK');return res.status(409).json({ok:false,error:'round_not_flying'});}
    const r=round.rows[0],bet=await client.query('SELECT id,stake_stars,cashout_multiplier,source_inventory_id FROM crash_bets WHERE round_id=$1 AND telegram_id=$2 FOR UPDATE',[r.id,telegramId]);
    if(!bet.rowCount||bet.rows[0].cashout_multiplier!==null){await client.query('ROLLBACK');return res.status(409).json({ok:false,error:'bet_not_active'});}
    const elapsed=Date.now()-new Date(r.started_at).getTime(),mult=Math.floor(multiplierAt(elapsed)*10000)/10000;
    if(mult>=Number(r.crash_multiplier)){await client.query('ROLLBACK');return res.status(409).json({ok:false,error:'round_already_crashed'});}
    const payout=Math.floor(Number(bet.rows[0].stake_stars)*mult);
    let upgradedGift = null, createdInventoryId = null;
    if (bet.rows[0].source_inventory_id) {
      const source = await client.query('SELECT item_key FROM inventory WHERE id=$1 AND telegram_id=$2 FOR UPDATE',[bet.rows[0].source_inventory_id,telegramId]);
      const sourceGift = GIFT_DATA[source.rows[0]?.item_key];
      const target = Object.entries(GIFT_DATA).filter(([key,g]) => key !== 'random_nft' && Number(g.value) > Number(bet.rows[0].stake_stars) && Number(g.value) <= Number(bet.rows[0].stake_stars)*mult).sort((a,b)=>Number(b[1].value)-Number(a[1].value))[0];
      if (!sourceGift || !target) { await client.query('ROLLBACK'); return res.status(409).json({ok:false,error:'no_upgrade_at_multiplier'}); }
      const [key,gift] = target;
      await client.query("UPDATE inventory SET status='upgraded' WHERE id=$1",[bet.rows[0].source_inventory_id]);
      const created = await client.query(`INSERT INTO inventory(telegram_id,item_key,name,emoji,rarity,value_stars,source_type,source_ref) VALUES($1,$2,$3,$4,$5,$6,'crash',$7) RETURNING id`,[telegramId,key,gift.name,gift.emoji,gift.rarity,gift.value,'crash:'+r.id]);
      createdInventoryId = String(created.rows[0].id); upgradedGift = {key,name:gift.name,emoji:gift.emoji,value:Number(gift.value)};
      await client.query('UPDATE crash_bets SET cashout_multiplier=$2,payout_stars=$3,cashout_inventory_id=$4 WHERE id=$1',[bet.rows[0].id,mult,payout,createdInventoryId]);
    } else {
      await client.query('UPDATE crash_bets SET cashout_multiplier=$2,payout_stars=$3 WHERE id=$1',[bet.rows[0].id,mult,payout]);
      await client.query(`INSERT INTO wallet_ledger(telegram_id,amount_stars,entry_type,reference_id) VALUES($1,$2,'crash_payout',$3)`,[telegramId,payout,'crash:'+r.id+':payout:'+telegramId]);
    }
    await client.query('COMMIT');
    res.json({ok:true,multiplier:mult,payout,upgradedGift,inventoryId:createdInventoryId});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('[CRASH CASHOUT]',error.code||error.message);res.status(500).json({ok:false,error:'crash_cashout_failed'});}
  finally{client.release();}
});
module.exports={router,startCrashEngine};
