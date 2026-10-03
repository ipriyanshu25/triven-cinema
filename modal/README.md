# Modal GPU service

This folder is the serverless inference backend for Triven Cinema.

- CPU prefetch caches the gated `Lightricks/LTX-2.5-Diffusers` model into a Modal Volume.
- A B200 GPU container starts only when a generation job is submitted.
- `max_containers=1` provides a budget safety rail for the MVP.
- Preview uses the distilled single-stage path.
- 1080p uses distilled generation + latent 2x upscaling + stage-2 refinement, then FFmpeg crops to a standard ratio.
- Final MP4s are uploaded to Cloudflare R2/S3-compatible object storage.

See the root `README.md` for the full setup commands.
