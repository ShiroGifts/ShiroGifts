const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./pool');

async function migrate() {
  if (!pool) return;
  const schemaPath = path.join(__dirname, '../../db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('[DB MIGRATION] Schema is up to date');
}

module.exports = { migrate };
