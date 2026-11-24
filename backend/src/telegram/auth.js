const { validateInitData } = require('./validateInitData');

function telegramUserFromRequest(req) {
  const initData = req.header('x-telegram-init-data');
  const validated = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  return validated?.user || null;
}

module.exports = { telegramUserFromRequest };
