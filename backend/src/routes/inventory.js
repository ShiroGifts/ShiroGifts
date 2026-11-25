const express = require('express');
const { randomUUID } = require('node:crypto');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');
const { notifyAdminGift } = require('../telegram/notifications');

const router = express.Router();
router.use(requireTelegramUser, requireAgeConfirmed);

function isAdmin(req) {
  return String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => x.trim()).includes(String(req.telegramUser.id));
}

router.post('/inventory/sell', async (req, res) => {
  const id = String(req.body && req.body.inventoryId || '');
  if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_inventory_id' });
  const telegramId = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const item = await client.query(
      "SELECT id, value_stars FROM inventory WHERE id = $1 AND telegram_id = $2 AND status = 'owned' FOR UPDATE",
      [id, telegramId]
    );
    if (!item.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'inventory_item_not_found' }); }
    const payout = Math.floor(Number(item.rows[0].value_stars) * 0.7);
    if (!Number.isSafeInteger(payout) || payout < 1) { await client.query('ROLLBACK'); return res.status(400).json({ ok: false, error: 'item_not_sellable' }); }
    await client.query("UPDATE inventory SET status = 'sold' WHERE id = $1", [id]);
    await client.query(
      "INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id) VALUES ($1, $2, 'sale', $3)",
      [telegramId, payout, 'sale:' + randomUUID()]
    );
    const wallet = await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1', [telegramId]);
    await client.query('COMMIT');
    res.json({ ok: true, payout, balance: Number(wallet.rows[0].balance) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[INVENTORY SELL ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'inventory_sell_failed' });
  } finally { client.release(); }
});

const TELEGRAM_GIFT_IDS = {
  bear:'5170233102089322756',
  heart:'5170145012310081615',
  rose:'5168103777563050263',
  cake:'5170144170496491616',
  bouquet:'5170314324215857265',
  rocket:'5170564780938756245',
  champ:'6028601630662853006',
  cup:'5168043875654172773',
  ring:'5170690322832818290',
  diamond:'5170521118301225164'
};
const CASE_CAPTIONS = {
  farm:'Фарм', starter:'Стартовый', mini:'Мини', bronze:'Бронзовый',
  silver:'Серебряный', gold:'Золотой', legend:'Легендарный',
  ruby:'Рубиновый', diamond:'Алмазный', cosmic:'Космический', nft:'NFT'
};
async function deliverTelegramGift(telegramId, itemKey, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const giftId = TELEGRAM_GIFT_IDS[itemKey];
  if (!token || !giftId) return { ok:false, error:'telegram_gift_unavailable' };
  const catalogResponse = await fetch('https://api.telegram.org/bot' + token + '/getAvailableGifts');
  const catalog = await catalogResponse.json();
  if (!catalogResponse.ok || !catalog.ok || !catalog.result?.gifts?.some(g => String(g.id) === giftId)) {
    return { ok:false, error:'telegram_gift_unavailable' };
  }
  const response = await fetch('https://api.telegram.org/bot' + token + '/sendGift', {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({ user_id:Number(telegramId), gift_id:giftId, text:caption.slice(0,128) })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    console.error('[TELEGRAM SEND GIFT]', result.description || 'sendGift failed');
    return { ok:false, error:'telegram_gift_send_failed' };
  }
  return { ok:true };
}

router.post('/inventory/withdraw', async (req, res) => {
  const id = String(req.body && req.body.inventoryId || '');
  if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_inventory_id' });
  const telegramId = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const item = await client.query(
      `SELECT id,item_key,name,rarity,source_type,source_ref FROM inventory
       WHERE id=$1 AND telegram_id=$2 AND status='owned' FOR UPDATE`,
      [id, telegramId]
    );
    if (!item.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ ok:false,error:'inventory_item_not_found' }); }
    const gift = item.rows[0];
    const isNft = String(gift.rarity).toUpperCase().includes('NFT') || gift.item_key === 'random_nft';
    if (isNft) {
      const refs = await client.query('SELECT COUNT(*)::int AS count FROM referrals WHERE referrer_telegram_id=$1',[telegramId]);
      if (Number(refs.rows[0].count)<5) {
        await client.query('ROLLBACK');
        return res.status(403).json({ok:false,error:'referrals_required',referralsCount:Number(refs.rows[0].count),referralsRequired:5});
      }
    }
    const recent = await client.query(
      `SELECT COUNT(*)::int AS count FROM withdrawal_requests
       WHERE telegram_id=$1 AND created_at>NOW()-INTERVAL '24 hours' AND status IN ('pending','approved','sent')`,
      [telegramId]
    );
    if(Number(recent.rows[0].count)>=3){await client.query('ROLLBACK');return res.status(429).json({ok:false,error:'withdrawal_daily_limit'});}
    if (!isNft) {
      const sourceType = gift.source_type || 'legacy';
      let caption = 'Выиграно в ShiroGifts';
      if (sourceType === 'case') caption = 'Выиграно в кейсе «' + (CASE_CAPTIONS[gift.source_ref] || gift.source_ref || 'ShiroGifts') + '»';
      else if (sourceType === 'upgrade') caption = 'Выиграно в апгрейде ShiroGifts';
      else if (sourceType === 'roulette') caption = 'Выиграно в рулетке ShiroGifts';
      const sent = await deliverTelegramGift(telegramId,gift.item_key,caption);
      if (!sent.ok) {
        await client.query('ROLLBACK');
        return res.status(sent.error==='telegram_gift_unavailable'?409:502).json({ok:false,error:sent.error});
      }
      const request = await client.query(
        `INSERT INTO withdrawal_requests(telegram_id,inventory_id,withdrawal_type,status,admin_note)
         VALUES($1,$2,'ordinary_gift','sent',$3) RETURNING id`,
        [telegramId,id,'Telegram sendGift: '+caption]
      );
      await client.query("UPDATE inventory SET status='withdrawn' WHERE id=$1",[id]);
      await client.query('COMMIT');
      notifyAdminGift({ telegramId, username: req.telegramUser.username, firstName: req.telegramUser.first_name, itemName: gift.name, source: 'Подарок отправлен в Telegram', inventoryId: id }).catch(() => {});
      return res.json({ok:true,delivered:true,requestId:String(request.rows[0].id),type:'ordinary_gift'});
    }
    const request = await client.query(
      `INSERT INTO withdrawal_requests(telegram_id,inventory_id,withdrawal_type)
       VALUES($1,$2,'random_nft') RETURNING id,status,created_at`,
      [telegramId,id]
    );
    await client.query("UPDATE inventory SET status='withdraw_pending' WHERE id=$1",[id]);
    await client.query('COMMIT');
    notifyAdminGift({ telegramId, username: req.telegramUser.username, firstName: req.telegramUser.first_name, itemName: gift.name, source: 'Заявка на вывод NFT', inventoryId: id }).catch(() => {});
    return res.json({ok:true,delivered:false,requestId:String(request.rows[0].id),status:request.rows[0].status,type:'random_nft'});
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[INVENTORY WITHDRAW ERROR]',error.code||error.message);
    res.status(500).json({ok:false,error:'withdrawal_request_failed'});
  } finally { client.release(); }
});

router.get('/admin/withdrawals', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'admin_only' });
  const rows = await pool.query(
    `SELECT wr.id, wr.telegram_id, wr.withdrawal_type, wr.status, wr.created_at,
            i.item_key, i.name, i.value_stars
     FROM withdrawal_requests wr LEFT JOIN inventory i ON i.id = wr.inventory_id
     WHERE wr.status IN ('pending','approved') ORDER BY wr.created_at ASC LIMIT 100`
  );
  res.json({ ok: true, requests: rows.rows });
});

router.post('/admin/withdrawals/:id/resolve', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'admin_only' });
  const id = String(req.params.id || '');
  const action = String(req.body && req.body.action || '');
  if (!/^\d+$/.test(id) || !['sent','rejected'].includes(action)) return res.status(400).json({ ok: false, error: 'invalid_resolution' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await client.query("SELECT id, inventory_id FROM withdrawal_requests WHERE id = $1 AND status = 'pending' FOR UPDATE", [id]);
    if (!request.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'pending_request_not_found' }); }
    await client.query('UPDATE withdrawal_requests SET status = $2, updated_at = NOW(), admin_note = $3 WHERE id = $1', [id, action, String(req.body.note || '').slice(0,500)]);
    if (request.rows[0].inventory_id) {
      await client.query('UPDATE inventory SET status = $2 WHERE id = $1', [request.rows[0].inventory_id, action === 'sent' ? 'withdrawn' : 'owned']);
    }
    await client.query('COMMIT');
    res.json({ ok: true, status: action });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[WITHDRAWAL RESOLVE ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'withdrawal_resolution_failed' });
  } finally { client.release(); }
});

module.exports = router;
