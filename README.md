# WhatsApp Bot Starter

Simple WhatsApp Cloud API auto-reply bot. Eta plain Node.js diye banano, tai extra package install kora lagbe na.

## Setup

1. `.env.example` copy kore `.env` banan:

```bash
copy .env.example .env
```

2. `.env` file-e Meta dashboard-er values boshan:

```env
VERIFY_TOKEN=my_verify_token_123
WHATSAPP_TOKEN=your_meta_access_token
PHONE_NUMBER_ID=your_phone_number_id
GRAPH_API_VERSION=v25.0
```

3. Bot run korun:

```bash
node server.js
```

## Webhook URL

Localhost directly Meta webhook-e kaj korbe na. Local test-er jonno `ngrok` use korun:

```bash
ngrok http 3000
```

Ngrok URL jodi hoy:

```text
https://abc123.ngrok-free.app
```

Meta webhook callback URL hobe:

```text
https://abc123.ngrok-free.app/webhook
```

Verify token field-e `.env` er `VERIFY_TOKEN` value diben.

## Meta Webhook Fields

Webhook verify hoye gele WhatsApp webhook subscription-e `messages` field select korun.

## Test

Apnar verified recipient number theke Meta test number-e message pathan:

```text
hi
```

Bot reply debe:

```text
Assalamualaikum! Ki help lagbe?
```

Useful test messages:

```text
menu
price
order
support
urgent
```
