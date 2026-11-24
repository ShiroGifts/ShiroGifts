const express = require('express');
const { checkDatabase } = require('../db/pool');
const router = express.Router();

router.get('/health', async (_req, res) => {
  try {
    const database = await checkDatabase();
    res.json({ ok: true, service: 'shirogifts', database, timestamp: new Date().toISOString() });
  } catch (_error) {
    res.status(503).json({ ok: false, service: 'shirogifts', database: { configured: true, connected: false } });
  }
});

module.exports = router;
