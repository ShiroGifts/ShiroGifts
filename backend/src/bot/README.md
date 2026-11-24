# Telegram bot integration

Secrets must be stored only in Railway Variables. Never paste the bot token or webhook secret into source code, GitHub issues, or this chat.

## Required Railway variables

- `TELEGRAM_BOT_TOKEN` — token from BotFather.
- `TELEGRAM_WEBHOOK_SECRET` — a private random string used to authenticate Telegram webhook requests.
- `WEBAPP_URL` — public HTTPS base URL, for example `https://shirogifts-production.up.railway.app`.
- `TELEGRAM_BOT_USERNAME` — bot username without the @ sign.
- `TELEGRAM_CHANNEL_USERNAME` — channel username without the @ sign.

When all three required webhook values are configured, the server registers `/api/telegram/webhook` automatically on startup.

## Telegram Stars top-ups

The Mini App requests an invoice link from the server. The invoice uses currency `XTR`, and amounts are limited to 5–10,000 Stars. The server stores a pending invoice payload before requesting the link.

The webhook validates `pre_checkout_query` against the stored user, amount, currency and expiry. The balance is credited only after Telegram sends `successful_payment`. Payment charge IDs and invoice payloads are checked to prevent duplicate credits.

## Still to implement

- Channel membership checks through `getChatMember`.
- Server-authoritative case opening and inventory mutations.
- Server-authoritative upgrade and Crash mechanics (or keep those features disabled).
- Real gift delivery, support flow and admin review for withdrawals.
- Legal and age-eligibility review before enabling paid random mechanics or gift withdrawals.
