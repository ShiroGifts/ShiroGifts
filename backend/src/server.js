require('dotenv').config();
const path = require('node:path');
const express = require('express');
const healthRoutes = require('./routes/health');
const accountRoutes = require('./routes/account');
const { router: paymentRoutes } = require('./routes/payments');
const telegramWebhookRoutes = require('./routes/telegramWebhook');
const { migrate } = require('./db/migrate');

const app = express();
const port = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use('/api', healthRoutes);
app.use('/api', accountRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/telegram', telegramWebhookRoutes);

// The UI is still in staged development; authenticated account data is served by /api/me.

app.use(express.static(path.join(__dirname, '../../frontend')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../../frontend/index.html')));

app.listen(port, () => {
  console.log(`ShiroGifts server listening on ${port}`);
  migrate().catch(error => console.error('[DB MIGRATION ERROR]', error.code || error.message));
});
