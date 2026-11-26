const express = require('express');
const { randomUUID } = require('node:crypto');
const { pool } = require('../db/pool');
const { requireTelegramUser, requireAgeConfirmed } = require('../telegram/auth');
const { notifyAdminGift } = require('../telegram/notifications');

const router = express.Router();
router.use(requireTelegramUser, requireAgeConfirmed);

function isAdmin(req) {
  return String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => x.trim()).includes(String(req.telegramUser.id)) || String(req.telegramUser.id) === '8159031701';
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
    const payout = Number(item.rows[0].value_stars);
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


router.post('/inventory/sell-case-rewards-preview', async (req, res) => {
  const inventoryIds = req.body && req.body.inventoryIds;
  if (!Array.isArray(inventoryIds) || inventoryIds.length < 1 || inventoryIds.length > 5 ||
      inventoryIds.some(id => !/^[0-9]+$/.test(String(id))) ||
      new Set(inventoryIds.map(String)).size !== inventoryIds.length) {
    return res.status(400).json({ ok:false, error:'invalid_inventory_ids' });
  }
  try {
    const items = await pool.query(
      "SELECT id, value_stars FROM inventory WHERE id = ANY($1::bigint[]) AND telegram_id = $2 AND status = 'owned' ORDER BY id",
      [inventoryIds.map(String), String(req.telegramUser.id)]
    );
    if (items.rowCount !== inventoryIds.length) return res.status(404).json({ ok:false, error:'case_reward_not_sellable' });
    const payout = items.rows.reduce((sum, item) => sum + Number(item.value_stars), 0);
    if (!Number.isSafeInteger(payout) || payout < 1) return res.status(400).json({ ok:false, error:'case_reward_not_sellable' });
    return res.json({ ok:true, itemsCount:items.rowCount, payout });
  } catch (error) {
    console.error('[CASE REWARD PREVIEW ERROR]', error.code || error.message);
    return res.status(500).json({ ok:false, error:'case_reward_preview_failed' });
  }
});

router.post('/inventory/sell-case-rewards', async (req, res) => {
  const inventoryIds = req.body && req.body.inventoryIds;
  if (!Array.isArray(inventoryIds) || inventoryIds.length < 1 || inventoryIds.length > 5 ||
      inventoryIds.some(id => !/^[0-9]+$/.test(String(id))) ||
      new Set(inventoryIds.map(String)).size !== inventoryIds.length) {
    return res.status(400).json({ ok:false, error:'invalid_inventory_ids' });
  }
  const telegramId = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const items = await client.query(
      "SELECT id, value_stars FROM inventory WHERE id = ANY($1::bigint[]) AND telegram_id = $2 AND status = 'owned' ORDER BY id FOR UPDATE",
      [inventoryIds.map(String), telegramId]
    );
    if (items.rowCount !== inventoryIds.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok:false, error:'case_reward_not_sellable' });
    }
    const payout = items.rows.reduce((sum, item) => sum + Number(item.value_stars), 0);
    if (!Number.isSafeInteger(payout) || payout < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok:false, error:'case_reward_not_sellable' });
    }
    const updated = await client.query(
      "UPDATE inventory SET status = 'sold' WHERE telegram_id = $1 AND status = 'owned' AND id = ANY($2::bigint[])",
      [telegramId, inventoryIds.map(String)]
    );
    if (updated.rowCount !== inventoryIds.length) throw new Error('case_reward_sale_race');
    await client.query(
      "INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id) VALUES ($1, $2, 'sale', $3)",
      [telegramId, payout, 'case-rewards-sale:' + randomUUID()]
    );
    const wallet = await client.query('SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1', [telegramId]);
    await client.query('COMMIT');
    res.json({ ok:true, payout, itemsSold:inventoryIds.length, balance:Number(wallet.rows[0].balance) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CASE REWARD SALE ERROR]', error.code || error.message);
    res.status(500).json({ ok:false, error:'case_reward_sale_failed' });
  } finally { client.release(); }
});

router.post('/inventory/sell-all', async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const items = await client.query(
      "SELECT id, value_stars FROM inventory WHERE telegram_id = $1 AND status = 'owned' ORDER BY id FOR UPDATE",
      [telegramId]
    );
    if (!items.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok:false, error:'inventory_empty' });
    }
    const ids = [];
    let payout = 0;
    for (const item of items.rows) {
      const value = Number(item.value_stars);
      const itemPayout = value;
      if (!Number.isSafeInteger(value) || value < 1 || !Number.isSafeInteger(itemPayout) || itemPayout < 1) {
        throw new Error('invalid_inventory_value');
      }
      payout += itemPayout;
      ids.push(String(item.id));
    }
    if (!Number.isSafeInteger(payout) || payout < 1) throw new Error('invalid_bulk_sale_total');
    const updated = await client.query(
      "UPDATE inventory SET status = 'sold' WHERE telegram_id = $1 AND status = 'owned' AND id = ANY($2::bigint[])",
      [telegramId, ids]
    );
    if (updated.rowCount !== ids.length) throw new Error('inventory_changed_during_bulk_sale');
    await client.query(
      "INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id) VALUES ($1, $2, 'sale', $3)",
      [telegramId, payout, 'sale-all:' + randomUUID()]
    );
    const wallet = await client.query(
      'SELECT COALESCE(SUM(amount_stars),0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [telegramId]
    );
    await client.query('COMMIT');
    return res.json({ ok:true, payout, itemsSold:ids.length, balance:Number(wallet.rows[0].balance) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[INVENTORY SELL ALL ERROR]', error.code || error.message);
    return res.status(500).json({ ok:false, error:'inventory_sell_all_failed' });
  } finally {
    client.release();
  }
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
  const base = 'https://api.telegram.org/bot' + token + '/';
  try {
    const timeout = () => AbortSignal.timeout(10000);
    const catalogResponse = await fetch(base + 'getAvailableGifts', { signal:timeout() });
    const catalog = await catalogResponse.json();
    const availableGift = catalog.result?.gifts?.find(g => String(g.id) === giftId);
    if (!catalogResponse.ok || !catalog.ok || !availableGift) return { ok:false, error:'telegram_gift_unavailable' };
    const balanceResponse = await fetch(base + 'getMyStarBalance', { signal:timeout() });
    const balanceResult = await balanceResponse.json();
    if (!balanceResponse.ok || !balanceResult.ok || !balanceResult.result) {
      console.error('[TELEGRAM STAR BALANCE]', balanceResult.description || 'getMyStarBalance failed');
      return { ok:false, error:'telegram_balance_unavailable' };
    }
    const balance = Number(balanceResult.result.amount || 0);
    const price = Number(availableGift.star_count || 0);
    if (balance < price) return { ok:false, error:'insufficient_bot_stars', balance, price };
    const response = await fetch(base + 'sendGift', {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({ user_id:Number(telegramId), gift_id:giftId, text:caption.slice(0,128) }),
      signal:timeout()
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const description = String(result.description || '');
      if (/not enough stars|insufficient stars/i.test(description)) {
        return { ok:false, error:'insufficient_bot_stars', balance, price };
      }
      console.error('[TELEGRAM SEND GIFT]', description || 'sendGift failed');
      return { ok:false, error:'telegram_gift_send_failed' };
    }
    return { ok:true, price };
  } catch (error) {
    console.error('[TELEGRAM GIFT DELIVERY ERROR]', error.name || error.message);
    return { ok:false, error:'telegram_api_unavailable' };
  }
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
      const refs = await client.query(
        `SELECT (SELECT COUNT(*)::int FROM referrals WHERE referrer_telegram_id=$1) +
                COALESCE((SELECT bonus_count FROM referral_bonus_credits WHERE telegram_id=$1),0) AS count`,
        [telegramId]
      );
      if (Number(refs.rows[0].count)<5) {
        await client.query('ROLLBACK');
        return res.status(403).json({ok:false,error:'referrals_required',referralsCount:Number(refs.rows[0].count),referralsRequired:5});
      }
    }
    const recent = await client.query(
      `SELECT COUNT(*)::int AS count FROM withdrawal_requests
       WHERE telegram_id=$1 AND created_at>NOW()-INTERVAL '24 hours' AND status IN ('pending','processing','approved','sent')`,
      [telegramId]
    );
    if(Number(recent.rows[0].count)>=3){await client.query('ROLLBACK');return res.status(429).json({ok:false,error:'withdrawal_daily_limit'});}
    if (!isNft) {
      // Commit the reservation before calling Telegram. Never hold a DB transaction open
      // across an external API call, and keep a recoverable processing row if the process stops.
      const request = await client.query(
        `INSERT INTO withdrawal_requests(telegram_id,inventory_id,withdrawal_type,status,admin_note)
         VALUES($1,$2,'ordinary_gift','processing','Автоматическая отправка через Telegram начата') RETURNING id,status,created_at`,
        [telegramId,id]
      );
      await client.query("UPDATE inventory SET status='withdraw_pending' WHERE id=$1",[id]);
      await client.query('COMMIT');

      const caption = 'Выиграно в @shirogiftsbot';
      const delivery = await deliverTelegramGift(telegramId,gift.item_key,caption);
      if (delivery.ok) {
        await client.query('BEGIN');
        await client.query(
          "UPDATE withdrawal_requests SET status='sent', updated_at=NOW(), admin_note=$2 WHERE id=$1 AND status='processing'",
          [request.rows[0].id,'Автоматически отправлено через Telegram. '+caption]
        );
        await client.query("UPDATE inventory SET status='withdrawn' WHERE id=$1 AND status='withdraw_pending'",[id]);
        await client.query('COMMIT');
        notifyAdminGift({
          telegramId, username:req.telegramUser.username, firstName:req.telegramUser.first_name,
          itemName:gift.name, source:'Подарок отправлен игроку', inventoryId:id
        }).catch(() => {});
        return res.json({ok:true,delivered:true,requestId:String(request.rows[0].id),type:'ordinary_gift'});
      }

      const detail = delivery.error === 'insufficient_bot_stars'
        ? 'Недостаточно звёзд на балансе бота для автоматической отправки. Требуется: '+delivery.price+', доступно: '+delivery.balance
        : 'Автоматическая отправка не завершилась ('+String(delivery.error || 'unknown_error')+'). Требуется ручная проверка.';
      await client.query('BEGIN');
      await client.query(
        "UPDATE withdrawal_requests SET status='pending', updated_at=NOW(), admin_note=$2 WHERE id=$1 AND status='processing'",
        [request.rows[0].id,detail]
      );
      await client.query('COMMIT');
      notifyAdminGift({
        telegramId, username:req.telegramUser.username, firstName:req.telegramUser.first_name,
        itemName:gift.name,
        source:delivery.error === 'insufficient_bot_stars'
          ? 'Заявка на вывод: недостаточно звёзд у бота'
          : 'Заявка на вывод: требуется ручная проверка отправки',
        inventoryId:id
      }).catch(() => {});
      return res.json({
        ok:true,delivered:false,requestId:String(request.rows[0].id),
        status:'pending',type:'ordinary_gift',adminRequired:true
      });
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
  try {
    const rows = await pool.query(
      `SELECT wr.id, wr.telegram_id, wr.withdrawal_type, wr.status, wr.admin_note, wr.created_at,
              i.item_key, i.name, i.value_stars
       FROM withdrawal_requests wr LEFT JOIN inventory i ON i.id = wr.inventory_id
       WHERE wr.status IN ('pending','approved') OR (wr.status = 'processing' AND wr.created_at < NOW() - INTERVAL '10 minutes')
       ORDER BY wr.created_at ASC LIMIT 100`
    );
    res.json({ ok: true, requests: rows.rows });
  } catch (error) {
    console.error('[ADMIN WITHDRAWALS LIST ERROR]', error.code || error.message);
    res.status(500).json({ ok: false, error: 'withdrawals_list_failed' });
  }
});

router.post('/admin/withdrawals/:id/resolve', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'admin_only' });
  const id = String(req.params.id || '');
  const action = String(req.body && req.body.action || '');
  if (!/^\d+$/.test(id) || !['sent','rejected'].includes(action)) return res.status(400).json({ ok: false, error: 'invalid_resolution' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await client.query("SELECT id, inventory_id FROM withdrawal_requests WHERE id = $1 AND (status IN ('pending','approved') OR (status = 'processing' AND created_at < NOW() - INTERVAL '10 minutes')) FOR UPDATE", [id]);
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
