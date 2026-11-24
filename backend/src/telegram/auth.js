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

async function requireAgeConfirmed(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT age_confirmed_at FROM users WHERE telegram_id = $1',
      [String(req.telegramUser.id)]
    );
    if (!result.rowCount || !result.rows[0].age_confirmed_at) {
      return res.status(403).json({ ok: false, error: 'age_confirmation_required' });
    }
    next();
  } catch (error) {
    console.error('[AGE CHECK ERROR]', error.code || error.message);
    res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
}

module.exports = { requireTelegramUser, requireAgeConfirmed };
