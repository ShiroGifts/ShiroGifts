const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('./pool');

async function migrate() {
  if (!pool) throw new Error('DATABASE_URL is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shirogifts_migrations'))");
    const schema = await fs.readFile(path.join(__dirname, '../../db/schema.sql'), 'utf8');
    await client.query(schema);
    await client.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO app_settings(key, value)
      VALUES ('gift_admin_notifications_enabled', 'true')
      ON CONFLICT (key) DO NOTHING;
    CREATE TABLE IF NOT EXISTS referral_bonus_credits (
      telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
      bonus_count INTEGER NOT NULL DEFAULT 0 CHECK (bonus_count BETWEEN 0 AND 5),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'legacy';
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS source_ref TEXT;

    ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_status_check;
    ALTER TABLE inventory ADD CONSTRAINT inventory_status_check CHECK (status IN ('owned','sold','withdrawn','upgraded','burned','withdraw_pending','crash_locked'));
    ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS inventory_id BIGINT REFERENCES inventory(id);
    ALTER TABLE withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;
    ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_requests_status_check
      CHECK (status IN ('pending','processing','approved','sent','rejected'));
    DROP INDEX IF EXISTS withdrawal_one_pending_per_item;
    CREATE UNIQUE INDEX withdrawal_one_pending_per_item ON withdrawal_requests(inventory_id) WHERE status IN ('pending','processing','approved') AND inventory_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS pending_ton_payments (
      id UUID PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      sender_address TEXT NOT NULL,
      amount_stars BIGINT NOT NULL CHECK (amount_stars BETWEEN 5 AND 10000),
      amount_nanotons NUMERIC(30,0) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
      tx_hash TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pending_ton_payments_tx_hash_unique
      ON pending_ton_payments(tx_hash) WHERE tx_hash IS NOT NULL;

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

    CREATE TABLE IF NOT EXISTS daily_name_rewards (
      telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
      last_claimed_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS daily_name_rewards_last_claimed_idx ON daily_name_rewards(last_claimed_at);


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

    ALTER TABLE case_openings DROP CONSTRAINT IF EXISTS case_openings_reward_type_check;
    ALTER TABLE case_openings DROP CONSTRAINT IF EXISTS case_openings_check;
    ALTER TABLE case_openings DROP CONSTRAINT IF EXISTS case_openings_reward_shape_check;
    ALTER TABLE case_openings ADD CONSTRAINT case_openings_reward_type_check
      CHECK (reward_type IN ('gift','stars','nothing'));
    ALTER TABLE case_openings ADD CONSTRAINT case_openings_reward_shape_check CHECK (
      (reward_type = 'gift' AND reward_key IS NOT NULL AND reward_stars IS NULL AND inventory_id IS NOT NULL)
      OR (reward_type = 'stars' AND reward_key IS NULL AND reward_stars IS NOT NULL AND inventory_id IS NULL)
      OR (reward_type = 'nothing' AND reward_key IS NULL AND reward_stars IS NULL AND inventory_id IS NULL)
    );

    ALTER TABLE case_openings DROP CONSTRAINT IF EXISTS case_openings_case_price_check;
    ALTER TABLE case_openings ADD CONSTRAINT case_openings_case_price_check CHECK (case_price >= 0);

    ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_status_check;
    ALTER TABLE inventory ADD CONSTRAINT inventory_status_check
      CHECK (status IN ('owned','sold','withdrawn','upgraded','burned','withdraw_pending','crash_locked'));

    CREATE TABLE IF NOT EXISTS upgrade_events (
      request_id UUID PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      source_inventory_id BIGINT NOT NULL REFERENCES inventory(id),
      target_key TEXT NOT NULL,
      chance NUMERIC(8,6) NOT NULL CHECK (chance > 0 AND chance <= 1),
      success BOOLEAN NOT NULL,
      created_inventory_id BIGINT REFERENCES inventory(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS upgrade_events_user_idx ON upgrade_events(telegram_id, created_at DESC);
    ALTER TABLE upgrade_events ADD COLUMN IF NOT EXISTS double_reward BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE upgrade_events ADD COLUMN IF NOT EXISTS second_created_inventory_id BIGINT REFERENCES inventory(id);

    CREATE TABLE IF NOT EXISTS mines_games (
      id UUID PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      bet_stars BIGINT NOT NULL CHECK (bet_stars BETWEEN 1 AND 10000),
      mine_count SMALLINT NOT NULL CHECK (mine_count BETWEEN 3 AND 10),
      mine_positions SMALLINT[] NOT NULL,
      picked_positions SMALLINT[] NOT NULL DEFAULT '{}',
      server_seed TEXT NOT NULL,
      seed_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','lost','cashed_out')),
      multiplier NUMERIC(12,6) NOT NULL DEFAULT 1,
      payout_stars BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS mines_games_one_active_per_user ON mines_games(telegram_id) WHERE status='active';
    CREATE INDEX IF NOT EXISTS mines_games_user_created_idx ON mines_games(telegram_id, created_at DESC);


    ALTER TABLE crash_rounds ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
    ALTER TABLE crash_rounds ADD COLUMN IF NOT EXISTS server_seed TEXT;
    -- Ledger entry types evolve with app features; avoid blocking startup on historical valid entries.
    ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_entry_type_check;
    CREATE INDEX IF NOT EXISTS crash_rounds_status_idx ON crash_rounds(status, id DESC);
    ALTER TABLE crash_bets ADD COLUMN IF NOT EXISTS source_inventory_id BIGINT REFERENCES inventory(id);
    ALTER TABLE crash_bets ADD COLUMN IF NOT EXISTS cashout_inventory_id BIGINT REFERENCES inventory(id);
    ALTER TABLE crash_bets ADD COLUMN IF NOT EXISTS wager_currency TEXT NOT NULL DEFAULT 'STARS';
    CREATE INDEX IF NOT EXISTS crash_bets_round_idx ON crash_bets(round_id, created_at DESC);
    ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_status_check;
    ALTER TABLE inventory ADD CONSTRAINT inventory_status_check CHECK (status IN ('owned','sold','withdrawn','upgraded','burned','withdraw_pending','crash_locked','crash_preorder_locked'));
    CREATE TABLE IF NOT EXISTS crash_preorders (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      wager_type TEXT NOT NULL CHECK (wager_type IN ('stars','gift')),
      amount_stars BIGINT CHECK (amount_stars IS NULL OR amount_stars BETWEEN 1 AND 10000),
      wager_currency TEXT NOT NULL DEFAULT 'STARS' CHECK (wager_currency IN ('STARS','TON','NFT')),
      inventory_id BIGINT REFERENCES inventory(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','activated','cancelled','failed')),
      activated_round_id BIGINT REFERENCES crash_rounds(id),
      error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK ((wager_type='stars' AND amount_stars IS NOT NULL AND inventory_id IS NULL) OR (wager_type='gift' AND amount_stars IS NULL AND inventory_id IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crash_preorders_one_pending_per_user ON crash_preorders(telegram_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS crash_preorders_queue_idx ON crash_preorders(status, created_at ASC);

    CREATE TABLE IF NOT EXISTS promo_codes (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      reward_stars BIGINT NOT NULL CHECK (reward_stars > 0),
      usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
      uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      created_by BIGINT NOT NULL REFERENCES users(telegram_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id BIGSERIAL PRIMARY KEY,
      promo_id BIGINT NOT NULL REFERENCES promo_codes(id),
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      reward_stars BIGINT NOT NULL CHECK (reward_stars > 0),
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (promo_id, telegram_id)
    );
    CREATE INDEX IF NOT EXISTS promo_codes_active_idx ON promo_codes(active, expires_at);
    CREATE INDEX IF NOT EXISTS promo_redemptions_user_idx ON promo_redemptions(telegram_id, redeemed_at DESC);
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { migrate };
