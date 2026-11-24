require('dotenv').config();
const path = require('node:path');
const express = require('express');
const healthRoutes = require('./routes/health');
const { validateInitData } = require('./telegram/validateInitData');

const app = express();
const port = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use('/api', healthRoutes);

// The mockup is served for visual review only. Its demo balance and outcomes are not authoritative.
app.get('/api/session', (req, res) => {
  const initData = req.header('x-telegram-init-data');
  const validated = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!validated) return res.status(401).json({ ok: false, error: 'invalid_telegram_init_data' });
  return res.json({ ok: true, user: { id: validated.user.id, first_name: validated.user.first_name || '' } });
});

app.use(express.static(path.join(__dirname, '../../frontend')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../../frontend/index.html')));

app.listen(port, () => {
  console.log(`ShiroGifts server listening on ${port}`);
});
