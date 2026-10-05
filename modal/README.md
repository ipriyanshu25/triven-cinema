# Triven Cinema — Modal Runtime

`cinema.py` intentionally separates three workloads:

1. **B200 `LTXWorker`** — LTX-2.5 Fast/Pro inference and scene stitching only.
2. **CPU `finalize_generation`** — technical QC, thumbnailing and optional S3-compatible publishing.
3. **CPU `edit_video`** — non-destructive FFmpeg edit versions + QC.

## Deploy

```bash
modal deploy modal/cinema.py
```

Fast + Pro weights only need to be prefetched when the model cache is missing:

```bash
modal run modal/cinema.py::prefetch_models
```

## Cancellation

The web API first writes `cancelRequested=true`, so cancellation is race-safe even if the Modal call ID is not visible yet. `FunctionCall.cancel(terminate_containers=False)` is used so the call is cancelled without intentionally destroying the warm B200 container.

## Warm-container behavior

`LTXWorker` keeps `max_containers=1` and uses a 120-second `scaledown_window`. This improves back-to-back demo renders while keeping GPU concurrency capped. Tune this only after measuring queue time and spend.

## Storage

Without storage credentials, files remain in `triven-cinema-output-cache` (Modal Volume). Media endpoints require a stable HMAC token derived from `TRIVEN_WEB_SECRET`, so generation IDs alone do not expose the files.

Optional keys in `triven-cinema-runtime`:

```text
STORAGE_S3_ENDPOINT
STORAGE_S3_ACCESS_KEY_ID
STORAGE_S3_SECRET_ACCESS_KEY
STORAGE_S3_BUCKET
STORAGE_PUBLIC_BASE_URL
```

The app still keeps a Volume copy so CPU editing can access the source master without downloading it from public storage.
