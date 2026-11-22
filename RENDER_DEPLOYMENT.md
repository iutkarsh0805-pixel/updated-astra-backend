# Render Deployment

## Render service

Create a Web Service from this repository and set:

- Root Directory: `updated_backend`
- Runtime: Node
- Build Command: `npm ci && npm run build`
- Pre-Deploy Command: `npm run prisma:migrate:deploy`
- Start Command: `npm start`
- Health Check Path: `/health`

Alternatively, apply `render.yaml` through Render Blueprint.

## Required environment variables

Set real production values in Render:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `CORS_ORIGIN`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`

Optional:

- `SENTRY_DSN`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`
- `LOG_LEVEL`

## Google OAuth

After deploying, set `GOOGLE_REDIRECT_URI` to:

`https://<render-service-domain>/api/v1/auth/google/callback`

Add the same HTTPS URL to Google Cloud as an authorized redirect URI.

## Google Meet and transcripts

Astrologers must connect Google OAuth with Calendar events, user email, and Drive read-only scopes. Google Meet recording/transcription requires a Google Workspace account and recording must be enabled for the meeting. To request transcription, call `POST /api/v1/meetings/:id/transcript` with a Google Drive recording file ID; processing runs asynchronously and the transcript is read through the meeting/booking transcript endpoints.

## Razorpay webhook

Set the Razorpay webhook URL to:

`https://<render-service-domain>/api/v1/payments/webhook`

Use the webhook secret as `RAZORPAY_WEBHOOK_SECRET`.

## Security

Never commit `.env`, API keys, database URLs, OAuth secrets, or webhook secrets.
