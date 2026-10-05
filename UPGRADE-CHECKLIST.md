# Triven Cinema — Upgrade & Deployment Checklist

## 1. Protect the current deployment

- Back up `.env` and PostgreSQL.
- Keep the old deployment available until the new health check and smoke test pass.
- Do not paste `HF_TOKEN` or `TRIVEN_WEB_SECRET` into source control.

## 2. Install and migrate

```bash
npm ci
npm run db:generate
npm run db:deploy
```

The migration adds `CANCEL_REQUESTED` / `CANCELLED` / `ANALYZING`, director/QC JSON, render-attempt audit rows and non-destructive `VideoVersion` rows.

## 3. Validate locally

```bash
npm run lint
npm run build
python3 -m py_compile modal/cinema.py
```

Start PostgreSQL and the app, then test in mock mode first if desired.

## 4. Configure production

Next.js `.env`:

```env
MOCK_MODE="false"
NEXT_PUBLIC_MOCK_MODE="false"
MODAL_API_URL="https://YOUR-DEPLOYED-MODAL-ENDPOINT"
MODAL_WEB_SECRET="same-value-as-TRIVEN_WEB_SECRET"
TRIVEN_MAX_ACTIVE_GENERATIONS="2"
TRIVEN_MAX_ACTIVE_EDITS="4"
TRIVEN_MAX_VERSIONS_PER_GENERATION="20"
TRIVEN_ACTIVE_STALE_HOURS="6"
```

Optional whole-app protection for a demo/private deployment:

```env
TRIVEN_BASIC_AUTH_USER="your-user"
TRIVEN_BASIC_AUTH_PASSWORD="a-long-random-password"
```

Modal secret `triven-cinema-runtime`:

```text
HF_TOKEN
TRIVEN_WEB_SECRET
```

Optional S3-compatible storage:

```text
STORAGE_S3_ENDPOINT
STORAGE_S3_ACCESS_KEY_ID
STORAGE_S3_SECRET_ACCESS_KEY
STORAGE_S3_BUCKET
STORAGE_PUBLIC_BASE_URL
```

## 5. Deploy Modal

```bash
modal deploy modal/cinema.py
```

No model prefetch is required for this upgrade if Fast + Pro weights are already cached. If the cache is missing:

```bash
modal run modal/cinema.py::prefetch_models
```

## 6. Health + smoke test

```bash
curl -i http://localhost:3000/api/health
```

Then validate:

- Fast / 1080p / 24 FPS / 5 sec
- cancellation while queued and while generating
- immediate new render after cancellation
- 30–60 sec scene plan and stitch
- Pro mode
- Technical QC report + thumbnail
- edit: trim + crop + color + normalize audio
- original master remains unchanged
- edited version can be previewed/downloaded and deleted
- deleting a terminal generation cleans its retained Modal Volume/object-storage prefix

## 7. Production gates before public launch

- Use persistent object storage/CDN rather than relying only on the Modal Volume for long-term retention. Volume-backed media is HMAC-signed; if using S3, choose private/signed delivery when content must not be public.
- Put the app behind real user authentication/authorization if it becomes multi-user; Basic Auth is only a private/demo gate.
- Add centralized error monitoring and alerting.
- Load-test B200 queue/capacity limits and 4K/48–50 FPS paths before advertising them as guaranteed SLAs.
- Add a dedicated TTS + lip-sync pipeline for transcript-locked dialogue.
- Add image/reference-conditioned workflows for character-critical continuity.
