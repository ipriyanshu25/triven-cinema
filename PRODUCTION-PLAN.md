# Triven Cinema — Production Upgrade Plan

This build is intentionally split into **two systems** so expensive generation and flexible post-production do not fight each other.

## Section 1 — Production Intelligence + Generation

### A. Gather and understand the brief before GPU work

Every request is converted into a `ProductionBrief` before inference. The director extracts or infers:

- intent and video type
- visual language
- recurring characters
- recurring locations/environments
- camera language
- audio direction
- must-have and avoid rules
- continuity lock
- warnings for exact counts, exact dialogue, typography/logo fidelity and text-only identity consistency

Common scene formats are parsed directly: `SCENE 1 — TITLE`, `TIME:`, `DURATION:`, `VISUAL:`, `ACTION:`, `CAMERA:`, `AUDIO:`, `DIALOGUE:`, `TRANSITION:` and `MUST HAVE:`.

The previous failure mode where the beginning of one giant master prompt could be repeated into every scene is removed. Each scene now receives a scene-specific visual/action/audio prompt plus the continuity lock. Production labels, timestamps and camera notes are explicitly forbidden from becoming spoken dialogue.

### B. Profile-aware shot planning

Long videos are broken into renderable clips. Scene duration is automatically normalized to the selected profile so high-resolution/Pro/high-FPS work does not accidentally send an oversized single clip to the worker.

The UI keeps 30 FPS only as an **experimental self-hosted** option. The production profiles are 24/25/48/50 FPS.

### C. Job safety and spend control

- client request IDs make generation submission idempotent from the browser
- configurable active-render capacity limits uncontrolled B200 spend
- stale active database rows stop counting against capacity after a configurable safety window
- `RenderAttempt` rows preserve provider call IDs/status/errors for diagnosis
- `CANCEL_REQUESTED` and `CANCELLED` are real states
- immediate-stop race is handled even if the user cancels before a Modal call ID is written
- cancellation uses `terminate_containers=False` so stopping one render does not intentionally kill the warm B200 container
- B200 `scaledown_window` is extended to 120 seconds for faster consecutive renders while `max_containers=1` remains a cost guard

### D. Separate expensive inference from finishing

The B200 does only model inference and scene stitching. It then writes a staging master to the shared Volume and hands off to CPU.

CPU finalization performs full-stream and pixel/statistical technical checks:

- FFprobe stream/codec/duration/FPS inspection
- black-frame detection
- freeze detection
- silence detection
- audio mean/peak analysis
- frame luminance and saturation signal statistics
- thumbnail generation
- final publish

These checks inspect the actual output pixels/audio stream for technical defects; they are not a claim of semantic human-level understanding of every pixel.

### E. Storage and health

Development can keep using the persistent Modal Volume. Volume-backed video/thumbnail URLs are HMAC-signed so a guessed generation ID is not enough to fetch media. If S3-compatible credentials are present, masters, thumbnails and edit versions publish there automatically; use a private bucket/signed-CDN design if the S3 media itself must remain private.

`/api/health` verifies PostgreSQL and the deployed Modal API. Security headers are enabled. Optional Basic Auth can protect a private/demo deployment; a public multi-user launch should replace that with real identity + authorization.

---

## Section 2 — Post-Production + Editing

Completed videos now have a non-destructive editor. The original master is never overwritten; every edit creates a `VideoVersion` and gets its own QC report.

### Editing tools implemented

- trim start/end
- 0.25×–4× speed with audio tempo correction
- volume and mute
- loudness normalization
- audio/video fade in/out
- brightness
- contrast
- saturation
- sharpen
- blur
- cinematic vignette
- 16:9 / 9:16 / 1:1 crop
- 0° / 90° / 180° / 270° rotation
- horizontal mirror
- Cinematic / Vivid / Social / Clean presets
- original + edited version history
- delete edited versions and reclaim retained Volume/object-storage files
- preview and download the selected version
- technical QC + thumbnail for every edited version
- editor concurrency and per-video version safety limits
- deleting a terminal generation triggers retained media cleanup before the database row is removed

All edit rendering runs on CPU FFmpeg workers, not the B200.

### Capability boundary for the next production layer

The stable worker in this package remains self-hosted Diffusers text-to-video. LTX-2.5 also supports image-to-video, audio-to-video, start/last-frame control and native multi-shot; the open-source ecosystem additionally exposes control/customization workflows such as LoRA/IC-LoRA. These should be added as explicit workflow adapters with their own input upload, validation, cancellation, QC and asset tests rather than silently bolted onto the stable text-to-video path.

For exact dialogue, named voice consistency and lip synchronization, use a dedicated TTS + lip-sync stage. Native generated speech should not be treated as transcript-locked.
