const express = require('express');
const { requireTelegramUser } = require('../telegram/auth');
const router = express.Router();
router.use(requireTelegramUser);

router.get('/subscription/status', async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channel = process.env.TELEGRAM_CHANNEL_ID || (process.env.TELEGRAM_CHANNEL_USERNAME ? '@' + process.env.TELEGRAM_CHANNEL_USERNAME.replace(/^@/, '') : '@ShiroGifts');
  if (!token) return res.status(503).json({ ok: false, error: 'subscription_check_not_configured' });
  try {
    const response = await fetch('https://api.telegram.org/bot' + token + '/getChatMember', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: channel, user_id: Number(req.telegramUser.id) })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      console.error('[SUBSCRIPTION CHECK]', data.description || 'Telegram API error');
      return res.status(502).json({ ok: false, error: 'subscription_check_failed' });
    }
    const member = data.result;
    const isMember = ['creator', 'administrator', 'member'].includes(member.status) || (member.status === 'restricted' && member.is_member === true);
    return res.json({ ok: true, isMember });
  } catch (error) {
    console.error('[SUBSCRIPTION CHECK ERROR]', error.message);
    return res.status(502).json({ ok: false, error: 'subscription_check_failed' });
  }
});

module.exports = router;
