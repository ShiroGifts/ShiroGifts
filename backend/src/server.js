require('dotenv').config();
const path = require('node:path');
const express = require('express');
const healthRoutes = require('./routes/health');
const accountRoutes = require('./routes/account');
const caseRoutes = require('./routes/cases');
const telegramWebhookRoutes = require('./routes/telegramWebhook');
const { migrate } = require('./db/migrate');

const app = express();
const port = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use('/api', healthRoutes);
app.use('/api', accountRoutes);
app.use('/api', caseRoutes);
app.use('/api', telegramWebhookRoutes);

app.use(express.static(path.join(__dirname, '../../frontend')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../../frontend/index.html')));

async function configureTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const baseUrl = process.env.WEBAPP_URL;
  if (!token || !secret || !baseUrl) {
    console.warn('[TELEGRAM] Webhook not configured: required variables are missing');
    return;
  }
  const url = new URL('/api/telegram/webhook', baseUrl).toString();
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ['message', 'pre_checkout_query'],
      drop_pending_updates: false
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || 'Telegram setWebhook failed');
  console.log('[TELEGRAM] Webhook registered');
}

async function start() {
  if (process.env.DATABASE_URL) {
    await migrate();
    console.log('[DB] Migrations applied');
  } else {
    console.warn('[DB] DATABASE_URL missing; account and payment APIs are unavailable');
  }
  await configureTelegramWebhook();
  app.listen(port, () => console.log(`ShiroGifts server listening on ${port}`));
}

start().catch(error => {
  console.error('[STARTUP ERROR]', error.code || error.message);
  process.exit(1);
});
