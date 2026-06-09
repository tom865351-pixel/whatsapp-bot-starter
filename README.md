# Premium WhatsApp Mail Shop Bot

Render-ready WhatsApp Cloud API shop bot for digital mail/account products.

## Features

- Auto user registration by WhatsApp number
- WhatsApp interactive list menu
- Profile and balance
- Product catalog
- Single and bulk buy
- Auto delivery from stock after purchase
- Order history
- Deposit request and deposit status
- Coupon redeem
- Referral code
- Sell request submission
- Support flow
- Admin commands
- Product and stock management
- Deposit approve/reject with audit log
- Ban/unban and add balance
- Broadcast
- Low stock alert
- Optional Gemini AI support agent

## Render Environment Variables

Required:

```env
WHATSAPP_VERIFY_TOKEN=my_verify_token_123
WHATSAPP_ACCESS_TOKEN=your_production_or_test_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
ADMIN_IDS=8801XXXXXXXXX,16078827307
```

Optional:

```env
CURRENCY_SYMBOL=TK
MIN_DEPOSIT=100
SUPPORT_WHATSAPP_NUMBER=
BKASH_NUMBER=
NAGAD_NUMBER=
ROCKET_NUMBER=
BINANCE_PAY_ID=
USDT_TRC20_ADDRESS=
USDT_BEP20_ADDRESS=
LOW_STOCK_ALERT_THRESHOLD=5
AI_ENABLED=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
```

The older env names still work too:

```env
VERIFY_TOKEN=
WHATSAPP_TOKEN=
PHONE_NUMBER_ID=
```

## WhatsApp Webhook

Callback URL:

```text
https://your-render-service.onrender.com/webhook
```

Verify token:

```text
my_verify_token_123
```

Subscribe to:

```text
messages
```

## User Commands

```text
menu
shop
buy P00001
bulk P00001 5
topup
deposit 500 TX12345 bkash
status
orders
profile
coupon WELCOME10
refer
sell product details | expected price | contact
support
ai amar ki korte hobe
```

## Admin Commands

Admin number must be in `ADMIN_IDS`, comma-separated, without `+`.

```text
/admin
/stats
/products
/addproduct Gmail Account|50|Fresh gmail account
/stock P00001 email@example.com|password
/deposits
/approve DEP00001
/reject DEP00001 invalid txid
/addbal 16078827307 500 manual topup
/ban 16078827307 reason
/unban 16078827307
/broadcast message
```

## Local Run

```bash
copy .env.example .env
node server.js
```

Health check:

```text
http://localhost:3000/health
```

Debug status:

```text
http://localhost:3000/debug/status
```

## Data Storage

This Render version uses a lightweight JSON store in `data/store.json` so the bot can run without paid database setup. For serious production, attach PostgreSQL and migrate the store to a persistent DB.

Never commit `.env`, `webhook.log`, or `data/`.
