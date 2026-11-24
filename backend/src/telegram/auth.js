const { validateInitData } = require('./validateInitData');
const { pool } = require('../db/pool');

async function requireTelegramUser(req, res, next) {
  const initData = req.header('x-telegram-init-data');
  const validated = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!validated) return res.status(401).json({ ok: false, error: 'invalid_telegram_init_data' });
  const u = validated.user;
  try {
    await pool.query(
      `INSERT INTO users (telegram_id, username, first_name, last_seen_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (telegram_id) DO UPDATE SET
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         last_seen_at = NOW()`,
      [String(u.id), u.username || null, u.first_name || '']
    );
    req.telegramUser = u;
    next();
  } catch (error) {
    console.error('[AUTH DB ERROR]', error.code || error.message);
    res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
}

module.exports = { requireTelegramUser };
