# Triven Cinema — One-Day MVP

A complete starter for the project described in the call: prompt -> optional AI storyboard -> LTX-2.5 -> serverless B200 -> MP4 -> object storage -> Triven Cinema UI.

## What is included

- Professional Next.js 16 studio UI
- Direct generation mode
- AI scene/storyboard mode with editable scenes
- Character/style continuity context
- 16:9, 9:16 and 1:1 output controls
- Preview and 1080p modes
- Native-audio toggle
- Prompt enhancement when `OPENAI_API_KEY` is configured
- PostgreSQL + Prisma generation history
- Async Modal job submission and polling
- Serverless B200 GPU worker
- LTX-2.5 Diffusers integration
- CPU model prefetch into persistent Modal Volume
- Two-stage latent upscaling path for 1080p
- FFmpeg cropping and scene concatenation
- Cloudflare R2 / S3-compatible upload
- GPU time + approximate GPU cost tracking
- `MOCK_MODE=true` for $0 local testing

## Important scope

The ZIP does **not** include LTX-2.5 weights. They are very large and gated. You must accept the LTX model terms on Hugging Face and provide an `HF_TOKEN` to Modal.

The one-day MVP intentionally enables only LTX-2.5. WAN / Seedance / other providers should be added behind the provider layer after the primary pipeline is stable.

---

# 1. Prerequisites

Install:

- Node.js 20+ (22 recommended)
- npm
- Docker Desktop (for the easiest local PostgreSQL setup)
- Python 3.10+
- A Modal account
- A Hugging Face account with access to `Lightricks/LTX-2.5-Diffusers`
- A Cloudflare R2 bucket (or another S3-compatible bucket)

For the first local UI test you need only Node, npm and Docker. You can keep `MOCK_MODE=true` and skip Modal/Hugging Face/R2.

---

# 2. Fast local setup — no GPU cost

From the project root:

```bash
cp .env.example .env
```

Keep:

```env
MOCK_MODE="true"
NEXT_PUBLIC_MOCK_MODE="true"
```

Start PostgreSQL:

```bash
docker compose up -d db
```

Install packages:

```bash
npm install
```

Create Prisma tables:

```bash
npx prisma migrate deploy
```

Run the application:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

In mock mode, submitted generations return the bundled demo video. This verifies the UI, database, storyboard, generation records and result player before you spend any GPU money.

---

# 3. Optional scene-planning AI

The app works without an LLM key; it uses a deterministic storyboard fallback.

To enable AI planning/prompt enhancement, put this in `.env`:

```env
OPENAI_API_KEY="your-key"
SCENE_PLANNER_MODEL="gpt-5-mini"
```

You can replace this module later with Claude, Gemini, a local model, or Triven's own intelligence layer.

---

# 4. Hugging Face access for LTX-2.5

Open the LTX-2.5 Diffusers repository on Hugging Face and accept its access terms.

Create a Hugging Face read token that can access gated repositories.

Do **not** put the Hugging Face token into the Next.js frontend.

It belongs only in the Modal secret.

---

# 5. Create Cloudflare R2 storage

Create a bucket, for example:

```text
triven-cinema
```

Create R2 API credentials with object read/write access to that bucket.

You need:

```text
R2_ENDPOINT
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
```

Typical endpoint format:

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

`R2_PUBLIC_BASE_URL` must point to a public R2.dev URL or, preferably, a custom CDN domain that serves the bucket, for example:

```text
https://cinema-cdn.triven.ai
```

---

# 6. Install and authenticate Modal

Install Modal:

```bash
python3 -m pip install modal
```

Authenticate:

```bash
modal setup
```

Create a strong random secret for communication between Next.js and Modal. On macOS/Linux:

```bash
openssl rand -hex 32
```

Save that value. You will use it as `TRIVEN_WEB_SECRET` and `MODAL_WEB_SECRET`.

---

# 7. Create the Modal runtime secret

Run this as one command, replacing the values:

```bash
modal secret create triven-cinema-runtime \
  HF_TOKEN="hf_xxxxxxxxx" \
  TRIVEN_WEB_SECRET="your-long-random-secret" \
  R2_ENDPOINT="https://ACCOUNT_ID.r2.cloudflarestorage.com" \
  R2_ACCESS_KEY_ID="xxxxxxxxx" \
  R2_SECRET_ACCESS_KEY="xxxxxxxxx" \
  R2_BUCKET="triven-cinema" \
  R2_PUBLIC_BASE_URL="https://cinema-cdn.example.com"
```

Never commit these secrets.

---

# 8. Prefetch LTX-2.5 on CPU

This is important. It avoids using expensive B200 time to download the model.

From the repository root:

```bash
modal run modal/cinema.py::prefetch_models
```

This downloads the gated `Lightricks/LTX-2.5-Diffusers` repository into the persistent Modal Volume `triven-cinema-model-cache`.

The first download is large. That is normal.

---

# 9. Deploy the Modal GPU API

Run:

```bash
modal deploy modal/cinema.py
```

Modal will print a web endpoint for the `api` function. Copy that URL.

Test it:

```bash
curl https://YOUR-MODAL-ENDPOINT/health
```

You should receive something similar to:

```json
{"ok":true,"model":"LTX-2.5","gpu":"B200"}
```

---

# 10. Connect Next.js to Modal

Edit `.env`:

```env
MOCK_MODE="false"
NEXT_PUBLIC_MOCK_MODE="false"
MODAL_API_URL="https://YOUR-MODAL-ENDPOINT"
MODAL_WEB_SECRET="the-same-secret-used-as-TRIVEN_WEB_SECRET"
```

Restart Next.js:

```bash
npm run dev
```

Now a generation request follows this flow:

```text
Browser
 -> Next.js POST /api/generations
 -> PostgreSQL Generation record
 -> Modal POST /submit
 -> B200 starts
 -> LTX-2.5 renders
 -> FFmpeg crops/stitches
 -> R2 upload
 -> Modal job state = COMPLETED
 -> Next.js polls/syncs state
 -> Browser displays final MP4
 -> B200 scales to zero
```

---

# 11. First paid test: use safe settings

For the first real render use:

```text
Mode: Direct
Aspect: 16:9
Quality: Preview / Fast
Duration: 5 seconds
Native audio: On
```

Do not start with a 60-second 1080p scene-mode render.

The Modal class is intentionally configured with:

```python
min_containers=0
max_containers=1
scaledown_window=30
```

That prevents the MVP from scaling to multiple B200 containers accidentally.

---

# 12. How 1080p works

The worker does not ask the model to start from a giant 1920x1080 latent.

For 16:9 it uses a model-friendly source size:

```text
960 x 544
 -> LTX latent generation
 -> 2x latent upscaler
 -> stage-2 distilled refinement
 -> 1920 x 1088
 -> FFmpeg crop
 -> 1920 x 1080
```

For vertical:

```text
544 x 960
 -> x2
 -> 1088 x 1920
 -> crop
 -> 1080 x 1920
```

For square:

```text
544 x 544
 -> x2
 -> 1088 x 1088
 -> crop
 -> 1080 x 1080
```

---

# 13. Scene mode

Scene mode calls `/api/plan` first and returns editable JSON-like scene objects.

The user can edit each scene before generation.

The app stores a `continuityContext` such as character identity, wardrobe, environment, lighting and lens language. The planner is instructed to preserve that continuity across scene prompts.

In this MVP each scene is rendered independently and then joined with FFmpeg. A later version should add last-frame -> next-scene image conditioning for stronger visual continuity.

---

# 14. Database

Main tables:

```text
Generation
Scene
```

Useful commands:

```bash
npm run db:studio
npm run db:migrate
npm run db:deploy
```

To reset the local Docker database completely:

```bash
docker compose down -v
docker compose up -d db
npx prisma migrate deploy
```

---

# 15. Production database

Do not use the local Docker URL on Vercel.

Create a managed PostgreSQL database on Neon, Supabase, Render, Railway, AWS RDS, etc.

Set production:

```env
DATABASE_URL="postgresql://..."
```

Then run:

```bash
npx prisma migrate deploy
```

---

# 16. Deploy the Next.js app

Vercel is the simplest option.

Push the project to GitHub, import it in Vercel, then add:

```text
DATABASE_URL
MOCK_MODE=false
OPENAI_API_KEY              (optional)
SCENE_PLANNER_MODEL         (optional)
MODAL_API_URL
MODAL_WEB_SECRET
```

Run the Prisma production migration against your production DB:

```bash
DATABASE_URL="your-production-url" npx prisma migrate deploy
```

No GPU dependencies need to be installed on Vercel. They live on Modal.

---

# 17. Architecture

```text
                            TRIVEN CINEMA

  Browser / Next.js
         |
         +--> /api/plan ----------> Scene Planner
         |
         +--> /api/generations ---> PostgreSQL
                                      |
                                      +--> Modal /submit
                                             |
                                             v
                                      Serverless B200
                                             |
                                          LTX-2.5
                                             |
                                  +----------+----------+
                                  |                     |
                              Direct clip          Scene clips
                                  |                     |
                                  +----------+----------+
                                             |
                                           FFmpeg
                                             |
                                        Cloudflare R2
                                             |
                                      Public video URL
                                             |
                                Next.js status polling
                                             |
                                          Browser
```

---

# 18. Cost tracking

The worker records:

```text
gpuSeconds
actualCost
```

The default B200 price constant in `modal/cinema.py` is:

```python
B200_PRICE_PER_SECOND = 0.001736
```

Cloud GPU pricing changes. Update that constant when Modal pricing changes. Treat the displayed cost as an estimate of GPU runtime, not a complete accounting invoice.

---

# 19. Troubleshooting

## Hugging Face 401 / 403

You have not accepted the gated model terms, your token cannot read gated repositories, or the token is missing from the Modal secret.

Recreate/update `triven-cinema-runtime`, then rerun:

```bash
modal run modal/cinema.py::prefetch_models
```

## `Job not found`

Ensure `MODAL_API_URL` points to the current deployed API endpoint and Next.js is sending the same secret as Modal expects.

## R2 upload succeeds but the browser cannot play the video

`R2_PUBLIC_BASE_URL` must be a public URL that actually serves the bucket. The S3 API endpoint itself is not normally a public media URL.

## B200 is unavailable

Modal GPU availability can vary. For temporary development you can change:

```python
gpu="B200"
```

to another GPU with enough memory, but performance and memory behavior will change. Keep B200 as the intended production target for this MVP.

## Out of memory

First test `preview` and 5 seconds. The current worker loads the primary pipeline and upsampler onto the B200. If you adapt it to smaller GPUs, use CPU offload/quantization rather than assuming the B200 configuration transfers directly.

## FFmpeg concat error

The generated scene clips should use identical output settings. If you later allow per-scene quality/ratio/fps settings, re-encode every clip to a common format before concatenating.

---

# 20. What I would build next

After the MVP is stable, add in this order:

1. Reference image upload + image-to-video.
2. Last-frame conditioning from Scene N into Scene N+1.
3. Scene-by-scene regeneration instead of regenerating the whole film.
4. Project/library UI with reusable characters and style bibles.
5. Queue limits, per-user quotas and billing.
6. WAN provider behind the same backend interface.
7. Premium Seedance provider for fallback/comparison.
8. ElevenLabs narration.
9. Remotion timeline with captions, logos, music and CTAs.
10. Research -> script -> shot plan -> render -> edit -> YouTube publish automation.

---

# Security / production notes

Before public launch, add authentication, user ownership on generations, rate limits, content moderation, upload validation, signed/private media URLs where appropriate, billing limits, terms, model-license review and abuse controls.

This ZIP is a working MVP foundation, not a production security/compliance package.
