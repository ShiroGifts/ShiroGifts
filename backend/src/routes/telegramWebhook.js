const express = require('express');
const { pool } = require('../db/pool');
const router = express.Router();

const broadcastDrafts = new Map();
const activeBroadcasts = new Set();

function isAdminTelegramId(id) {
  const ids = String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  return ids.includes(String(id));
}

async function telegramCall(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const error = new Error(data.description || `Telegram ${method} failed`);
    error.errorCode = data.error_code;
    throw error;
  }
  return data.result;
}

async function sendWelcome(chatId, from) {
  await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, last_seen_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_seen_at = NOW()`,
    [String(from.id), from.username || null, from.first_name || '']
  );
  const name = from.first_name ? `, ${from.first_name}` : '';
  await telegramCall('sendMessage', {
    chat_id: chatId,
    text: `Привет${name}! 👋 Добро пожаловать в ShiroGifts!

Здесь ты можешь открывать кейсы, получать подарки и NFT, собирать свою коллекцию, улучшать предметы и играть в мини-игры.

Заходи в приложение, изучай коллекцию и забирай свои подарки! 🎁`,
    reply_markup: {
      inline_keyboard: [[{
        text: '🎁 Открыть ShiroGifts',
        url: 'https://t.me/ShiroGiftsBot/ShiroNft'
      }]]
    }
  });
}

async function runBroadcast(adminId, messageText) {
  if (activeBroadcasts.has(String(adminId))) return;
  activeBroadcasts.add(String(adminId));
  const stats = { total: 0, sent: 0, blocked: 0, failed: 0 };
  try {
    const result = await pool.query('SELECT telegram_id FROM users ORDER BY created_at ASC');
    const recipients = result.rows;
    stats.total = recipients.length;
    for (const recipient of recipients) {
      try {
        await telegramCall('sendMessage', {
          chat_id: String(recipient.telegram_id),
          text: messageText,
          disable_web_page_preview: false
        });
        stats.sent += 1;
      } catch (error) {
        if (error.errorCode === 403 || /blocked|deactivated|chat not found/i.test(error.message)) {
          stats.blocked += 1;
        } else {
          stats.failed += 1;
        }
      }
      // Stay below Telegram's approximate global private-message rate limit.
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    await telegramCall('sendMessage', {
      chat_id: String(adminId),
      text: `Рассылка завершена.\nВсего в базе: ${stats.total}\nУспешно отправлено: ${stats.sent}\nНедоступны (бот заблокирован или чат недоступен): ${stats.blocked}\nДругие ошибки: ${stats.failed}`
    });
  } catch (error) {
    console.error('[BROADCAST ERROR]', error.code || error.message);
    await telegramCall('sendMessage', {
      chat_id: String(adminId),
      text: 'Не удалось завершить рассылку из-за ошибки базы данных или Telegram. Проверь логи сервера.'
    }).catch(() => {});
  } finally {
    activeBroadcasts.delete(String(adminId));
  }
}

router.post(['/telegram/webhook/:secret', '/telegram/webhook'], async (req, res) => {
  const expectedBytes = Buffer.from(process.env.TELEGRAM_WEBHOOK_SECRET || '', 'utf8');
  const urlMatch = String(req.originalUrl || '').match(/\/telegram\/webhook\/([^/?]+)/);
  const candidateToken = req.params.secret || (urlMatch ? urlMatch[1] : '');
  let decodedToken = '';
  try { decodedToken = decodeURIComponent(candidateToken); } catch (_) {}
  const pathBytes = Buffer.from(decodedToken, 'utf8');
  const headerBytes = Buffer.from(req.header('x-telegram-bot-api-secret-token') || '', 'utf8');
  const safeMatch = candidate => expectedBytes.length > 0 &&
    expectedBytes.length === candidate.length &&
    require('node:crypto').timingSafeEqual(candidate, expectedBytes);
  const pathMatches = safeMatch(pathBytes);
  const headerMatches = safeMatch(headerBytes);
  const validSecret = pathMatches || headerMatches;
  console.info('[TELEGRAM WEBHOOK AUTH CHECK]', {
    expectedConfigured: expectedBytes.length > 0,
    expectedLength: expectedBytes.length,
    pathLength: pathBytes.length,
    headerLength: headerBytes.length,
    pathMatches,
    headerMatches
  });
  if (!validSecret) {
    console.error('[TELEGRAM WEBHOOK AUTH FAILED]');
    return res.sendStatus(401);
  }
  const update = req.body || {};
  try {
    const message = update.message;
    if (message && message.chat && message.from && message.chat.type === 'private' && typeof message.text === 'string') {
      const chatId = message.chat.id;
      const userId = String(message.from.id);
      const text = message.text.trim();

      if (/^\/start(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
        await sendWelcome(chatId, message.from);
      } else if (isAdminTelegramId(userId) && /^\/broadcast(?:@\w+)?$/i.test(text)) {
        broadcastDrafts.set(userId, null);
        await telegramCall('sendMessage', {
          chat_id: chatId,
          text: 'Отправь следующим сообщением текст рассылки. Я покажу предпросмотр и попрошу подтверждение. Для отмены отправь /broadcast_cancel.'
        });
      } else if (isAdminTelegramId(userId) && /^\/broadcast_cancel(?:@\w+)?$/i.test(text)) {
        broadcastDrafts.delete(userId);
        await telegramCall('sendMessage', { chat_id: chatId, text: 'Рассылка отменена.' });
      } else if (isAdminTelegramId(userId) && /^\/broadcast_confirm(?:@\w+)?$/i.test(text)) {
        const draft = broadcastDrafts.get(userId);
        if (!draft) {
          await telegramCall('sendMessage', { chat_id: chatId, text: 'Нет подготовленной рассылки. Начни заново командой /broadcast.' });
        } else if (activeBroadcasts.has(userId)) {
          await telegramCall('sendMessage', { chat_id: chatId, text: 'Рассылка уже выполняется.' });
        } else {
          broadcastDrafts.delete(userId);
          await telegramCall('sendMessage', { chat_id: chatId, text: 'Принято. Начинаю рассылку. По завершении пришлю статистику.' });
          setImmediate(() => runBroadcast(userId, draft));
        }
      } else if (isAdminTelegramId(userId) && broadcastDrafts.has(userId) && broadcastDrafts.get(userId) === null) {
        if (!text || text.length > 4000 || text.startsWith('/')) {
          await telegramCall('sendMessage', { chat_id: chatId, text: 'Пришли обычный текст до 4000 символов или отправь /broadcast_cancel.' });
        } else {
          broadcastDrafts.set(userId, text);
          await telegramCall('sendMessage', {
            chat_id: chatId,
            text: `Предпросмотр рассылки:\n\n${text}\n\nЕсли всё верно, отправь /broadcast_confirm. Для отмены — /broadcast_cancel.`
          });
        }
      }
    }

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
      await telegramCall('answerPreCheckoutQuery', {
        pre_checkout_query_id: q.id,
        ok: valid,
        ...(valid ? {} : { error_message: 'Счёт недействителен или истёк. Создайте новый.' })
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
