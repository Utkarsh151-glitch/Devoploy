# Devoploy 

## Prerequisites
- Node.js 20+
- npm 10+
- Docker Desktop (or Docker Engine + Compose)
- Git CLI installed and available in PATH

## 1) Configure environment
Copy `.env.example` to `.env` and fill required secrets:

- `DATABASE_URL`
- `REDIS_URL`
- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`

Example local values are already provided for Postgres/Redis:

- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/devoploy`
- `REDIS_URL=redis://127.0.0.1:6379/0`

## 2) Start local infrastructure
```bash
docker compose up -d
```

This starts:
- Postgres (`localhost:5432`) with auto-init SQL from `docker/postgres/init`
- Redis (`localhost:6379`)

## 3) Install dependencies
```bash
npm install
```

## 4) Run web + worker
```bash
npm run dev
```

Expected:
- `apps/web` runs on `http://localhost:3000`
- `apps/worker` runs in a separate process and listens to BullMQ jobs

## Useful commands
Run only web:
```bash
npm run dev:web
```

Run only worker:
```bash
npm run dev:worker
```

Stop infrastructure:
```bash
docker compose down
```

## Notes
- This setup is fully self-hosted for local development; there is no Supabase dependency.
- Database access is direct Postgres via `packages/database` (`pg`).

## GitHub App Local Webhooks (ngrok or smee.io)
Your webhook endpoint is:

- `http://localhost:3000/api/github/webhook`

GitHub cannot call localhost directly, so use one of these forwarders:

### Option A: ngrok
1. Start web app:
```bash
npm run dev:web
```
2. In another terminal, run:
```bash
ngrok http 3000
```
3. Copy the HTTPS forwarding URL, e.g. `https://abcd-1234.ngrok-free.app`
4. Set GitHub App Webhook URL to:
   - `https://abcd-1234.ngrok-free.app/api/github/webhook`
5. Set GitHub App webhook secret exactly equal to `.env` value of `GITHUB_WEBHOOK_SECRET`.
6. Redeliver a `workflow_run` event from GitHub App settings and verify HTTP `200`.

### Option B: smee.io
1. Create a channel at `https://smee.io/new`.
2. In GitHub App settings, set Webhook URL to your smee channel URL.
3. Start local web app:
```bash
npm run dev:web
```
4. Start smee client forwarding:
```bash
npx smee-client -u https://smee.io/<your-channel-id> -t http://localhost:3000/api/github/webhook
```
5. Confirm deliveries reach local endpoint and pass signature validation.

## Workflow Run Failure Automation
When `workflow_run` completes with `failure`, the app does:
1. Validates webhook signature.
2. Fetches workflow logs via GitHub REST API.
3. Classifies failure with deterministic rules.
4. Stores analysis in Postgres (category, confidence, original snippet, explainability).
5. Creates/fetches fix branch.
6. Applies patch commit.
7. Opens pull request.
8. Adds PR comment:
   - "DevOps Intelligence detected failure category X."
   - "Applied fix Y."
   - "Confidence Z%."
