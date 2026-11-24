require('dotenv').config();
const path = require('node:path');
const express = require('express');
const healthRoutes = require('./routes/health');
const accountRoutes = require('./routes/account');
const caseRoutes = require('./routes/cases');
const promoRoutes = require('./routes/promos');
const adminRoutes = require('./routes/admin');
const upgradeRoutes = require('./routes/upgrades');
const inventoryRoutes = require('./routes/inventory');
const telegramWebhookRoutes = require('./routes/telegramWebhook');
const subscriptionRoutes = require('./routes/subscription');
const { router: crashRoutes, startCrashEngine } = require('./routes/crash');
const { migrate } = require('./db/migrate');

const app = express();
const port = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use('/api', healthRoutes);
app.use('/api', accountRoutes);
app.use('/api', caseRoutes);
app.use('/api', promoRoutes);
app.use('/api', adminRoutes);
app.use('/api', upgradeRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', telegramWebhookRoutes);
app.use('/api', subscriptionRoutes);
app.use('/api', crashRoutes);

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
  const url = new URL('/api/telegram/webhook/' + encodeURIComponent(secret), baseUrl).toString();
  for (let attempt = 1; attempt <= 4; attempt++) {
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
    if (response.ok && data.ok) {
      console.log('[TELEGRAM] Webhook registered');
      return;
    }
    if (data.error_code === 429 && attempt < 4) {
      const retryMs = Math.max(1000, Number(data.parameters?.retry_after || 1) * 1000 + 200);
      console.warn('[TELEGRAM] setWebhook rate limited; retrying', { attempt, retryMs });
      await new Promise(resolve => setTimeout(resolve, retryMs));
      continue;
    }
    throw new Error(data.description || 'Telegram setWebhook failed');
  }
}

async function start() {
  if (process.env.DATABASE_URL) {
    await migrate();
    console.log('[DB] Migrations applied');
    await startCrashEngine();
  } else {
    console.warn('[DB] DATABASE_URL missing; account and payment APIs are unavailable');
  }
  try {
    await configureTelegramWebhook();
  } catch (error) {
    console.error('[TELEGRAM WEBHOOK CONFIG ERROR]', error.message);
  }
  app.listen(port, () => console.log(`ShiroGifts server listening on ${port}`));
}

start().catch(error => {
  console.error('[STARTUP ERROR]', JSON.stringify({ code: error.code, message: error.message, constraint: error.constraint, table: error.table, column: error.column, detail: error.detail }));
  process.exit(1);
});
