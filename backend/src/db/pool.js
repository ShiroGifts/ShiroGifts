
const { Pool } = require('pg');

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

console.log('[DB CHECK] DATABASE_URL present:', hasDatabaseUrl);
console.log('[DB CHECK] DATABASE_SSL:', process.env.DATABASE_SSL || 'not set');

const pool = hasDatabaseUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
      connectionTimeoutMillis: 10000,
    })
  : null;

async function checkDatabase() {
  if (!pool) return { configured: false, connected: false };

  await pool.query('SELECT 1');
  return { configured: true, connected: true };
}

module.exports = { pool, checkDatabase };
