const express = require('express');
const { checkDatabase } = require('../db/pool');
const router = express.Router();

router.get('/health', async (_req, res) => {
  try {
    const database = await checkDatabase();
    res.json({ ok: true, service: 'shirogifts', database, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[DB CONNECTION ERROR]', {
      code: error.code || 'UNKNOWN',
      message: error.message || 'Database connection failed',
    });
    res.status(503).json({ ok: false, service: 'shirogifts', database: { configured: true, connected: false } });
  }
});

router.get('/online', async (_req, res) => {
  try {
    const result = await require('../db/pool').pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE last_seen_at >= NOW() - INTERVAL '2 minutes'"
    );
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, online: Number(result.rows[0].count) || 0 });
  } catch (error) {
    console.error('[ONLINE COUNT ERROR]', error.code || error.message);
    res.status(503).json({ ok: false, online: 0 });
  }
});

module.exports = router;
