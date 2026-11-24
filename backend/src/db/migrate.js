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

    ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_entry_type_check;
    ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_entry_type_check
      CHECK (entry_type IN ('topup','case_spend','case_reward','refund','admin_adjustment','gift_purchase'));

    CREATE TABLE IF NOT EXISTS case_openings (
      id BIGSERIAL PRIMARY KEY,
      request_id UUID NOT NULL UNIQUE,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      case_id TEXT NOT NULL,
      case_price BIGINT NOT NULL CHECK (case_price > 0),
      reward_type TEXT NOT NULL CHECK (reward_type IN ('gift','stars')),
      reward_key TEXT,
      reward_stars BIGINT CHECK (reward_stars IS NULL OR reward_stars > 0),
      inventory_id BIGINT REFERENCES inventory(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (reward_type = 'gift' AND reward_key IS NOT NULL AND reward_stars IS NULL AND inventory_id IS NOT NULL)
        OR
        (reward_type = 'stars' AND reward_key IS NULL AND reward_stars IS NOT NULL AND inventory_id IS NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS case_openings_user_idx ON case_openings(telegram_id, created_at DESC);
  `);
}

module.exports = { migrate };
