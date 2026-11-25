const express = require('express');
const { randomUUID } = require('node:crypto');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');
const { getCase, pickDrop, GIFT_DATA } = require('../game/cases');
const { notifyAdminGift } = require('../telegram/notifications');

const router = express.Router();
router.use(requireTelegramUser);
router.use(requireAgeConfirmed);


async function isSubscribedToChannel(telegramId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channel = process.env.TELEGRAM_CHANNEL_ID || (process.env.TELEGRAM_CHANNEL_USERNAME ? '@' + process.env.TELEGRAM_CHANNEL_USERNAME.replace(/^@/, '') : '@ShiroGifts');
  if (!token) throw new Error('subscription_check_not_configured');
  const response = await fetch('https://api.telegram.org/bot' + token + '/getChatMember', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: channel, user_id: Number(telegramId) })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error('subscription_check_failed');
  const member = data.result;
  return ['creator', 'administrator', 'member'].includes(member.status) || (member.status === 'restricted' && member.is_member === true);
}

router.get('/cases/free/status', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT created_at FROM case_openings WHERE telegram_id = $1 AND case_id = 'subscriber_free' ORDER BY created_at DESC LIMIT 1",
      [String(req.telegramUser.id)]
    );
    const nextClaimAt = result.rowCount ? new Date(new Date(result.rows[0].created_at).getTime() + 72 * 60 * 60 * 1000) : null;
    res.json({ ok: true, available: !nextClaimAt || nextClaimAt.getTime() <= Date.now(), nextClaimAt: nextClaimAt ? nextClaimAt.toISOString() : null });
  } catch (error) {
    console.error('[FREE CASE STATUS ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'free_case_status_failed' });
  }
});

router.post('/cases/free/open', async (req, res) => {
  const requestId = String(req.body && req.body.requestId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return res.status(400).json({ ok: false, error: 'invalid_request_id' });
  }
  const telegramId = String(req.telegramUser.id);
  try {
    if (!await isSubscribedToChannel(telegramId)) return res.status(403).json({ ok: false, error: 'subscription_required' });
  } catch (error) {
    console.error('[FREE CASE SUBSCRIPTION ERROR]', error.message);
    return res.status(502).json({ ok: false, error: error.message === 'subscription_check_not_configured' ? error.message : 'subscription_check_failed' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);
    const previous = await client.query(
      'SELECT reward_type, reward_key, reward_stars, inventory_id FROM case_openings WHERE request_id = $1 AND telegram_id = $2',
      [requestId, telegramId]
    );
    if (previous.rowCount) {
      const wallet = await client.query('SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1', [telegramId]);
      await client.query('COMMIT');
      const p = previous.rows[0];
      const reward = p.reward_type === 'stars'
        ? { type: 'stars', amount: Number(p.reward_stars) }
        : p.reward_type === 'nothing'
          ? { type: 'nothing' }
          : { type: 'gift', key: p.reward_key, inventoryId: p.inventory_id ? String(p.inventory_id) : null };
      return res.json({ ok: true, duplicate: true, balance: Number(wallet.rows[0].balance), reward });
    }

    const last = await client.query(
      "SELECT created_at FROM case_openings WHERE telegram_id = $1 AND case_id = 'subscriber_free' ORDER BY created_at DESC LIMIT 1",
      [telegramId]
    );
    const nextClaimAt = last.rowCount ? new Date(new Date(last.rows[0].created_at).getTime() + 72 * 60 * 60 * 1000) : null;
    if (nextClaimAt && nextClaimAt.getTime() > Date.now()) {
      await client.query('ROLLBACK');
      return res.status(429).json({ ok: false, error: 'free_case_cooldown', nextClaimAt: nextClaimAt.toISOString() });
    }

    const bronze = getCase('bronze');
    const drop = pickDrop(bronze.drops);
    let reward;
    let inventoryId = null;
    if (drop.type === 'stars') {
      await client.query(
        "INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id) VALUES ($1, $2, 'case_reward', $3)",
        [telegramId, drop.amount, 'free-case:' + requestId + ':reward']
      );
      reward = { type: 'stars', amount: drop.amount };
    } else if (drop.type === 'gift') {
      const gift = GIFT_DATA[drop.key];
      if (!gift) throw new Error('Unknown gift in free case');
      const inserted = await client.query(
        "INSERT INTO inventory (telegram_id, item_key, name, emoji, rarity, value_stars, source_type, source_ref) VALUES ($1, $2, $3, $4, $5, $6, 'case', 'subscriber_free') RETURNING id",
        [telegramId, drop.key, gift.name, gift.emoji, gift.rarity, gift.value]
      );
      inventoryId = String(inserted.rows[0].id);
      reward = { type: 'gift', key: drop.key, inventoryId };
    } else {
      reward = { type: 'nothing' };
    }

    await client.query(
      "INSERT INTO case_openings (request_id, telegram_id, case_id, case_price, reward_type, reward_key, reward_stars, inventory_id) VALUES ($1, $2, 'subscriber_free', 0, $3, $4, $5, $6)",
      [requestId, telegramId, drop.type, drop.type === 'gift' ? drop.key : null, drop.type === 'stars' ? drop.amount : null, inventoryId]
    );
    const wallet = await client.query('SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1', [telegramId]);
    await client.query('COMMIT');
    if (drop.type === 'gift') {
      notifyAdminGift({ telegramId, username: req.telegramUser.username, firstName: req.telegramUser.first_name, itemName: GIFT_DATA[drop.key]?.name || drop.key, source: 'Бесплатный кейс подписчика', inventoryId }).catch(() => {});
    }
    res.json({ ok: true, balance: Number(wallet.rows[0].balance), reward });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[FREE CASE OPEN ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'free_case_open_failed' });
  } finally { client.release(); }
});

router.post('/cases/open', async (req, res) => {
  const caseId = String(req.body && req.body.caseId || '');
  const requestId = String(req.body && req.body.requestId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return res.status(400).json({ ok: false, error: 'invalid_request_id' });
  }
  const selectedCase = getCase(caseId);
  if (!selectedCase) return res.status(404).json({ ok: false, error: 'case_not_found' });

  const telegramId = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);

    const previous = await client.query(
      'SELECT case_id, reward_type, reward_key, reward_stars, inventory_id FROM case_openings WHERE request_id = $1 AND telegram_id = $2',
      [requestId, telegramId]
    );
    if (previous.rowCount) {
      const wallet = await client.query(
        'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
        [telegramId]
      );
      await client.query('COMMIT');
      const p = previous.rows[0];
      const reward = p.reward_type === 'stars'
        ? { type: 'stars', amount: Number(p.reward_stars) }
        : p.reward_type === 'nothing'
          ? { type: 'nothing' }
          : { type: 'gift', key: p.reward_key, inventoryId: p.inventory_id ? String(p.inventory_id) : null };
      return res.json({ ok: true, duplicate: true, balance: Number(wallet.rows[0].balance), reward });
    }

    const wallet = await client.query(
      'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [telegramId]
    );
    const balance = Number(wallet.rows[0].balance);
    if (balance < selectedCase.price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'insufficient_balance', balance });
    }

    const drop = pickDrop(selectedCase.drops);
    const spendRef = 'case:' + requestId + ':spend';
    await client.query(
      `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
       VALUES ($1, $2, 'case_spend', $3)`,
      [telegramId, -selectedCase.price, spendRef]
    );

    let reward;
    let inventoryId = null;
    if (drop.type === 'stars') {
      const rewardRef = 'case:' + requestId + ':reward';
      await client.query(
        `INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id)
         VALUES ($1, $2, 'case_reward', $3)`,
        [telegramId, drop.amount, rewardRef]
      );
      reward = { type: 'stars', amount: drop.amount };
    } else if (drop.type === 'gift') {
      const gift = GIFT_DATA[drop.key];
      if (!gift) throw new Error('Unknown gift in case catalog');
      const inserted = await client.query(
        `INSERT INTO inventory (telegram_id, item_key, name, emoji, rarity, value_stars, source_type, source_ref)
         VALUES ($1, $2, $3, $4, $5, $6, 'case', $7) RETURNING id`,
        [telegramId, drop.key, gift.name, gift.emoji, gift.rarity, gift.value, selectedCase.id]
      );
      inventoryId = String(inserted.rows[0].id);
      reward = { type: 'gift', key: drop.key, inventoryId };
    } else if (drop.type === 'nothing') {
      reward = { type: 'nothing' };
    } else {
      throw new Error('Unknown reward type');
    }

    await client.query(
      `INSERT INTO case_openings
       (request_id, telegram_id, case_id, case_price, reward_type, reward_key, reward_stars, inventory_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [requestId, telegramId, selectedCase.id, selectedCase.price,
       drop.type, drop.type === 'gift' ? drop.key : null,
       drop.type === 'stars' ? drop.amount : null, inventoryId]
    );

    const newWallet = await client.query(
      'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [telegramId]
    );
    await client.query('COMMIT');
    if (drop.type === 'gift') {
      notifyAdminGift({ telegramId, username: req.telegramUser.username, firstName: req.telegramUser.first_name, itemName: GIFT_DATA[drop.key]?.name || drop.key, source: 'Выигрыш в кейсе «' + selectedCase.name + '»', inventoryId }).catch(() => {});
    }
    res.json({ ok: true, balance: Number(newWallet.rows[0].balance), reward });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CASE OPEN ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'case_open_failed' });
  } finally { client.release(); }
});


router.post('/cases/open-multiple', async (req,res)=>{
  const caseId=String(req.body&&req.body.caseId||''),requestIds=req.body&&req.body.requestIds,selectedCase=getCase(caseId);
  if(!selectedCase)return res.status(404).json({ok:false,error:'case_not_found'});
  const validId=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id));
  if(!Array.isArray(requestIds)||requestIds.length<2||requestIds.length>5||requestIds.some(id=>!validId(id))||new Set(requestIds).size!==requestIds.length)return res.status(400).json({ok:false,error:'invalid_request_ids'});
  const telegramId=String(req.telegramUser.id),client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT telegram_id FROM users WHERE telegram_id=$1 FOR UPDATE',[telegramId]);
    const previous=await client.query('SELECT request_id,case_id,reward_type,reward_key,reward_stars,inventory_id FROM case_openings WHERE telegram_id=$1 AND request_id=ANY($2::uuid[])',[telegramId,requestIds]);
    if(previous.rowCount){
      if(previous.rowCount!==requestIds.length||previous.rows.some(row=>row.case_id!==caseId)){await client.query('ROLLBACK');return res.status(409).json({ok:false,error:'partial_duplicate_batch'});}
      const byId=new Map(previous.rows.map(row=>[row.request_id,row]));
      const rewards=requestIds.map(id=>{const p=byId.get(id);return p.reward_type==='stars'?{type:'stars',amount:Number(p.reward_stars)}:p.reward_type==='nothing'?{type:'nothing'}:{type:'gift',key:p.reward_key,inventoryId:p.inventory_id?String(p.inventory_id):null};});
      const wallet=await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1',[telegramId]);await client.query('COMMIT');
      return res.json({ok:true,duplicate:true,balance:Number(wallet.rows[0].balance),rewards});
    }
    const wallet=await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1',[telegramId]);
    const total=selectedCase.price*requestIds.length;if(Number(wallet.rows[0].balance)<total){await client.query('ROLLBACK');return res.status(400).json({ok:false,error:'insufficient_balance',balance:Number(wallet.rows[0].balance)});}
    const rewards=[],notify=[];
    for(const requestId of requestIds){
      const drop=pickDrop(selectedCase.drops);await client.query("INSERT INTO wallet_ledger (telegram_id,amount_stars,entry_type,reference_id) VALUES ($1,$2,'case_spend',$3)",[telegramId,-selectedCase.price,'case:'+requestId+':spend']);
      let reward,inventoryId=null;
      if(drop.type==='stars'){await client.query("INSERT INTO wallet_ledger (telegram_id,amount_stars,entry_type,reference_id) VALUES ($1,$2,'case_reward',$3)",[telegramId,drop.amount,'case:'+requestId+':reward']);reward={type:'stars',amount:drop.amount};}
      else if(drop.type==='gift'){const gift=GIFT_DATA[drop.key];if(!gift)throw new Error('Unknown gift in case catalog');const ins=await client.query("INSERT INTO inventory (telegram_id,item_key,name,emoji,rarity,value_stars,source_type,source_ref) VALUES ($1,$2,$3,$4,$5,$6,'case',$7) RETURNING id",[telegramId,drop.key,gift.name,gift.emoji,gift.rarity,gift.value,selectedCase.id]);inventoryId=String(ins.rows[0].id);reward={type:'gift',key:drop.key,inventoryId};notify.push({key:drop.key,inventoryId});}
      else if(drop.type==='nothing')reward={type:'nothing'};else throw new Error('Unknown reward type');
      await client.query("INSERT INTO case_openings (request_id,telegram_id,case_id,case_price,reward_type,reward_key,reward_stars,inventory_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",[requestId,telegramId,selectedCase.id,selectedCase.price,drop.type,drop.type==='gift'?drop.key:null,drop.type==='stars'?drop.amount:null,inventoryId]);rewards.push(reward);
    }
    const updated=await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id=$1',[telegramId]);await client.query('COMMIT');
    for(const gift of notify)notifyAdminGift({telegramId,username:req.telegramUser.username,firstName:req.telegramUser.first_name,itemName:GIFT_DATA[gift.key]?.name||gift.key,source:'Выигрыш в кейсе «'+selectedCase.name+'»',inventoryId:gift.inventoryId}).catch(()=>{});
    res.json({ok:true,balance:Number(updated.rows[0].balance),rewards});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('[MULTI CASE OPEN ERROR]',error.code||error.message);res.status(500).json({ok:false,error:'case_open_failed'});}
  finally{client.release();}
});

module.exports = router;
