# Triven Cinema

Production-oriented AI video generation studio built with Next.js, PostgreSQL/Prisma, Modal, LTX-2.5 and FFmpeg.

The app follows a deliberate two-part pipeline:

1. **AI Director + Generation** — analyze the brief, build continuity, isolate scenes, render with LTX-2.5 on B200, then run CPU quality control.
2. **Post-Production + Editing** — non-destructive FFmpeg editing on CPU with version history and QC.

See `PRODUCTION-PLAN.md` for the architecture and implemented feature set.

## Local setup

```bash
cp .env.example .env
docker compose up -d db
npm ci
npm run db:deploy
npm run dev
```

The Docker PostgreSQL service is exposed on host port `55432`.

## Database upgrade

This version adds cancellation states, director/QC data, render attempts and non-destructive video versions.

```bash
npm run db:generate
npm run db:deploy
```

Do not use `db:push` on production data.

## Modal setup

The Modal secret `triven-cinema-runtime` must contain:

```text
HF_TOKEN
TRIVEN_WEB_SECRET
```

Optional production object storage can be enabled by adding:

```text
STORAGE_S3_ENDPOINT
STORAGE_S3_ACCESS_KEY_ID
STORAGE_S3_SECRET_ACCESS_KEY
STORAGE_S3_BUCKET
STORAGE_PUBLIC_BASE_URL
```

Any S3-compatible service can be used. Without these values, Triven uses the persistent Modal output Volume and serves media through HMAC-signed URLs derived from `TRIVEN_WEB_SECRET`.

Prefetch model assets once:

```bash
modal run modal/cinema.py::prefetch_models
```

Deploy:

```bash
modal deploy modal/cinema.py
```

Then put the deployed URL and matching secret in `.env`:

```env
MOCK_MODE="false"
NEXT_PUBLIC_MOCK_MODE="false"
MODAL_API_URL="https://YOUR-MODAL-ENDPOINT"
MODAL_WEB_SECRET="same-value-as-TRIVEN_WEB_SECRET"
TRIVEN_MAX_ACTIVE_GENERATIONS="2"
TRIVEN_MAX_ACTIVE_EDITS="4"
TRIVEN_MAX_VERSIONS_PER_GENERATION="20"
TRIVEN_ACTIVE_STALE_HOURS="6"
```

## Private/demo access guard

Set both values to enable HTTP Basic Auth across the app (except `/api/health`):

```env
TRIVEN_BASIC_AUTH_USER="demo"
TRIVEN_BASIC_AUTH_PASSWORD="use-a-long-random-password"
```

This is a deployment gate, not a replacement for user accounts/authorization in a public multi-user product.

## Health

`GET /api/health` checks PostgreSQL and, when not in mock mode, the deployed Modal API.

## Production validation

Run before deployment:

```bash
npm run lint
npm run build
python3 -m py_compile modal/cinema.py
```

Then smoke-test:

1. 5-second Fast 1080p render.
2. Cancel a queued render and immediately submit another.
3. Multi-scene 30–60 second render.
4. Pro render.
5. Open the AI Director plan and QC report.
6. Create an edited version (trim + color + audio normalization/finishing), wait for completion and preview it.
7. Delete an edited version and confirm the original master still plays.
8. Delete a terminal test generation and confirm its retained media is cleaned up.

## Important LTX-2.5 notes

The UI supports 24, 25, 48 and 50 FPS as production LTX profiles. 30 FPS is retained as an **experimental self-hosted Diffusers option** and should be load-tested before depending on it.

Native generated dialogue is not transcript-locked. For exact dialogue, named voices and production lip sync, add a dedicated TTS + lip-sync stage rather than relying on generative native speech alone.

For character-critical projects, image conditioning/reference-control workflows are the correct next step; text-only continuity is probabilistic even with a strong continuity bible.
