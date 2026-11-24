const assert = require('node:assert/strict');
const { pool, checkDatabase } = require('../backend/src/db/pool');
const { migrate } = require('../backend/src/db/migrate');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the database integration test');
}

async function run() {
  await migrate();
  await migrate();
  const health = await checkDatabase();
  assert.deepEqual(health, { configured: true, connected: true });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const telegramId = '987654321012345678';
    await client.query(
      "INSERT INTO users (telegram_id, first_name) VALUES ($1, $2) ON CONFLICT (telegram_id) DO NOTHING",
      [telegramId, 'CI test']
    );

    const wallet = await client.query(
      'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [telegramId]
    );
    const inventory = await client.query(
      "SELECT id FROM inventory_items WHERE telegram_id = $1 AND status = 'owned'",
      [telegramId]
    );
    assert.equal(Number(wallet.rows[0].balance), 0, 'a new account starts with zero Stars');
    assert.equal(inventory.rowCount, 0, 'a new account starts with an empty inventory');

    await client.query(
      "INSERT INTO pending_stars_invoices (payload, telegram_id, amount_stars) VALUES ($1, $2, 5)",
      ['ci-test-invoice', telegramId]
    );
    await client.query(
      "INSERT INTO star_payments (telegram_payment_charge_id, telegram_id, amount_stars, currency, status) VALUES ($1, $2, 5, 'XTR', 'succeeded')",
      ['ci-test-charge', telegramId]
    );
    await client.query(
      "INSERT INTO wallet_ledger (telegram_id, amount_stars, entry_type, reference_id) VALUES ($1, 5, 'topup', $2)",
      [telegramId, 'ci-test-charge']
    );
    const credited = await client.query(
      'SELECT COALESCE(SUM(amount_stars), 0)::bigint AS balance FROM wallet_ledger WHERE telegram_id = $1',
      [telegramId]
    );
    assert.equal(Number(credited.rows[0].balance), 5, 'a confirmed Stars payment is represented in the ledger');

    await assert.rejects(
      client.query(
        "INSERT INTO star_payments (telegram_payment_charge_id, telegram_id, amount_stars, currency, status) VALUES ($1, $2, 5, 'XTR', 'succeeded')",
        ['ci-test-charge', telegramId]
      ),
      error => error.code === '23505'
    );
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  console.log('PostgreSQL schema and new-account tests: OK');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
