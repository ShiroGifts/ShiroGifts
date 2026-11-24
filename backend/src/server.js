require('dotenv').config();
const path = require('node:path');
const express = require('express');
const healthRoutes = require('./routes/health');
const accountRoutes = require('./routes/account');
const { router: paymentRoutes } = require('./routes/payments');
const telegramWebhookRoutes = require('./routes/telegramWebhook');
const subscriptionRoutes = require('./routes/subscription');
const { migrate } = require('./db/migrate');
const { telegramApi } = require('./routes/payments');

const app = express();
const port = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use('/api', healthRoutes);
app.use('/api', accountRoutes);
app.use('/api', subscriptionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/telegram', telegramWebhookRoutes);

// The UI is still in staged development; authenticated account data is served by /api/me.

app.use(express.static(path.join(__dirname, '../../frontend')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../../frontend/index.html')));

async function start() {
  try {
    await migrate();
  } catch (error) {
    console.error('[DB MIGRATION ERROR]', error.code || error.message);
  }

  app.listen(port, () => {
    console.log(`ShiroGifts server listening on ${port}`);
    registerTelegramWebhook().catch(error =>
      console.error('[TELEGRAM WEBHOOK SETUP ERROR]', error.message)
    );
  });
}

async function registerTelegramWebhook() {
  const baseUrl = process.env.WEBAPP_URL?.replace(/\/+$/, '');
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET || !baseUrl) {
    console.log('[TELEGRAM WEBHOOK] Skipped: configure TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and WEBAPP_URL');
    return;
  }
  const result = await telegramApi('setWebhook', {
    url: `${baseUrl}/api/telegram/webhook`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'pre_checkout_query'],
    drop_pending_updates: false
  });
  console.log('[TELEGRAM WEBHOOK] Registered:', result);
}

start();
