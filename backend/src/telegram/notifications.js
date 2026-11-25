const { pool } = require('../db/pool');

async function notifyAdminGift({ telegramId, username, firstName, itemName, source, inventoryId }) {
  try {
    const setting = await pool.query("SELECT value FROM app_settings WHERE key = 'gift_admin_notifications_enabled'");
    if (setting.rowCount && setting.rows[0].value === 'false') return;
  } catch (error) {
    console.error('[GIFT ADMIN NOTIFY SETTING]', error.code || error.message);
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admins = String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!token || !admins.length) return;
  const who = [firstName, username ? '@' + username : null].filter(Boolean).join(' ');
  const text = [
    '🎁 Новый подарок в ShiroGifts',
    'Предмет: ' + String(itemName || 'Подарок'),
    'Игрок: ' + (who || 'без имени'),
    'Telegram ID: ' + String(telegramId),
    'Событие: ' + String(source || 'получение'),
    inventoryId ? 'ID предмета: ' + String(inventoryId) : null
  ].filter(Boolean).join('\n');
  await Promise.all(admins.map(async adminId => {
    try {
      const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: adminId, text })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) console.error('[GIFT ADMIN NOTIFY]', data.description || 'sendMessage failed');
    } catch (error) {
      console.error('[GIFT ADMIN NOTIFY]', error.message);
    }
  }));
}
module.exports = { notifyAdminGift };
