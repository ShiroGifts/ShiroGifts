# Telegram bot integration

Bot token must be stored only in Railway Variables as `TELEGRAM_BOT_TOKEN`.
Do not paste it into source code, GitHub issues, or this chat.

Next implementation steps:
1. Register a Telegram webhook over HTTPS.
2. Validate Telegram updates and make payment handling idempotent.
3. Handle `pre_checkout_query` and `successful_payment` for Stars (XTR).
4. Check channel membership with `getChatMember`.
5. Add `/paysupport` and clear support/contact information.

No payment or gift-sending actions are enabled in this starter.
