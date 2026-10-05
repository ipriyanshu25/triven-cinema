# Start Here — Triven Cinema Production Upgrade

This package is an upgrade of the supplied Triven Cinema project. It keeps the working Next.js -> Modal -> B200 -> LTX-2.5 pipeline, then adds production planning, safer job control, technical QC and a non-destructive CPU video editor.

## Upgrade an existing local copy

Back up the current project first. Then copy these files in place or apply the included production patch.

```bash
npm ci
npm run db:generate
npm run db:deploy
npm run lint
npm run build
python3 -m py_compile modal/cinema.py
modal deploy modal/cinema.py
npm run dev
```

The new Prisma migration is additive. Do **not** use `prisma db push` against production data.

You do not need to re-prefetch LTX model weights unless the Modal model cache was deleted or you intentionally change the model assets.

## First production smoke test

1. Open `/api/health` and confirm database + Modal are healthy.
2. Generate a 5-second Fast / 1080p / 24 FPS video.
3. Stop a second render while it is queued/generating, then immediately start another one.
4. Generate a 30–60 second multi-scene prompt and inspect **AI Director plan**.
5. Confirm the completed video has **Technical QC**.
6. Open **Video editor**, make a trim/color/audio edit, and confirm a new version is created without replacing the original.

Read `PRODUCTION-PLAN.md` for what changed and `UPGRADE-CHECKLIST.md` before deployment.
