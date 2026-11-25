-- Initial PostgreSQL schema. Apply only after reviewing the product rules and legal requirements.
CREATE TABLE IF NOT EXISTS users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  age_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  amount_stars BIGINT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('topup','case_spend','refund','admin_adjustment','gift_purchase')),
  reference_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS star_payments (
  telegram_payment_charge_id TEXT PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  amount_stars BIGINT NOT NULL CHECK (amount_stars > 0),
  currency TEXT NOT NULL CHECK (currency = 'XTR'),
  status TEXT NOT NULL DEFAULT 'succeeded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  referred_telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
  referrer_telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (referred_telegram_id <> referrer_telegram_id)
);

CREATE TABLE IF NOT EXISTS crash_rounds (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('scheduled','running','crashed','settled')),
  server_seed_hash TEXT NOT NULL,
  server_seed_revealed TEXT,
  client_seed TEXT NOT NULL,
  nonce BIGINT NOT NULL,
  crash_multiplier NUMERIC(12,4),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS crash_bets (
  id BIGSERIAL PRIMARY KEY,
  round_id BIGINT NOT NULL REFERENCES crash_rounds(id),
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  stake_stars BIGINT NOT NULL CHECK (stake_stars > 0),
  cashout_multiplier NUMERIC(12,4),
  payout_stars BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  withdrawal_type TEXT NOT NULL CHECK (withdrawal_type IN ('ordinary_gift','random_nft')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','approved','sent','rejected')),
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
