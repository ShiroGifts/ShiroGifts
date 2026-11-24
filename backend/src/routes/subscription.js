const express = require('express');
const { telegramUserFromRequest } = require('../telegram/auth');
const { telegramApi } = require('./payments');
const router = express.Router();

router.post('/subscription', async (req, res) => {
  const user = telegramUserFromRequest(req);
  if (!user) return res.status(401).json({ ok: false, error: 'invalid_telegram_init_data' });
  const channel = String(process.env.TELEGRAM_CHANNEL_USERNAME || '').replace(/^@/, '');
  if (!channel) return res.status(503).json({ ok: false, error: 'channel_not_configured' });

  try {
    const member = await telegramApi('getChatMember', {
      chat_id: `@${channel}`,
      user_id: Number(user.id)
    });
    const subscribed = member.status === 'creator' ||
      member.status === 'administrator' ||
      member.status === 'member' ||
      (member.status === 'restricted' && member.is_member === true);
    return res.json({ ok: true, subscribed });
  } catch (error) {
    console.error('[SUBSCRIPTION CHECK ERROR]', error.message);
    return res.status(503).json({ ok: false, error: 'subscription_check_unavailable' });
  }
});

module.exports = router;
