const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('./pool');

async function migrate() {
  if (!pool) throw new Error('DATABASE_URL is required');
  const schema = await fs.readFile(path.join(__dirname, '../../db/schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      item_key TEXT NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🎁',
      rarity TEXT NOT NULL DEFAULT 'common',
      value_stars BIGINT NOT NULL DEFAULT 0 CHECK (value_stars >= 0),
      status TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned','sold','withdrawn')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS inventory_user_status_idx ON inventory(telegram_id, status);
    CREATE TABLE IF NOT EXISTS pending_star_invoices (
      payload TEXT PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      amount_stars BIGINT NOT NULL CHECK (amount_stars BETWEEN 5 AND 10000),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
      expires_at TIMESTAMPTZ NOT NULL,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { migrate };
