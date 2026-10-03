"""Triven Cinema Modal backend.

Deploy:
  modal deploy modal/cinema.py

Pre-download LTX-2.5 to a persistent CPU-mounted Volume (recommended):
  modal run modal/cinema.py::prefetch_models

Required Modal Secret: triven-cinema-runtime
  HF_TOKEN
  TRIVEN_WEB_SECRET

Testing output is stored temporarily in a Modal Volume and streamed directly
from the Modal API. Cloudflare R2 is not required for the test phase.
"""


import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import modal

APP_NAME = "triven-cinema"
MODEL_REPO = "Lightricks/LTX-2.5-Diffusers"
CACHE_ROOT = "/cache/huggingface"
B200_PRICE_PER_SECOND = float(os.environ.get("B200_PRICE_PER_SECOND", "0.001736"))

app = modal.App(APP_NAME)
model_cache = modal.Volume.from_name("triven-cinema-model-cache", create_if_missing=True)
output_cache = modal.Volume.from_name("triven-cinema-output-cache", create_if_missing=True)
jobs = modal.Dict.from_name("triven-cinema-jobs", create_if_missing=True)
runtime_secret = modal.Secret.from_name("triven-cinema-runtime")
OUTPUT_ROOT = "/outputs"

web_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi>=0.118.0",
)

gpu_image = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04", add_python="3.12")
    .apt_install(
        "ffmpeg",
        "git",
        "build-essential",
        "gcc",
        "g++",
        "ninja-build",
    )
    .env({
        "CC": "/usr/bin/gcc",
        "CXX": "/usr/bin/g++",
    })
    .pip_install(
        "torch>=2.9.1",
        "torchvision>=0.24.1",
        "git+https://github.com/huggingface/diffusers.git",
        "transformers>=4.57.0",
        "accelerate>=1.10.0",
        "safetensors>=0.6.2",
        "sentencepiece>=0.2.1",
        "protobuf>=6.32.0",
        "huggingface_hub>=0.35.0",
        "av>=15.1.0",
        "imageio-ffmpeg>=0.6.0",
    )
    .env({"HF_HOME": CACHE_ROOT, "HF_HUB_ENABLE_HF_TRANSFER": "1"})
)


def _auth(secret: str | None) -> None:
    expected = os.environ.get("TRIVEN_WEB_SECRET", "")
    if not expected or secret != expected:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Unauthorized")


def _set_job(job_id: str, **values: Any) -> None:
    current = dict(jobs.get(job_id, {}))
    current.update(values)
    current["jobId"] = job_id
    current["updatedAt"] = time.time()
    jobs[job_id] = current


def _dimensions(aspect: str, quality: str) -> tuple[int, int, int, int]:
    # LTX-friendly source dimensions are multiples of 32. Cropping happens after generation.
    if quality == "1080p":
        mapping = {
            "16:9": (960, 544, 1920, 1080),
            "9:16": (544, 960, 1080, 1920),
            "1:1": (544, 544, 1080, 1080),
        }
    else:
        mapping = {
            "16:9": (768, 448, 768, 432),
            "9:16": (448, 768, 432, 768),
            "1:1": (512, 512, 512, 512),
        }
    return mapping[aspect]


def _crop(input_path: str, output_path: str, width: int, height: int) -> None:
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path,
        "-vf", f"crop={width}:{height}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", output_path,
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _concat(paths: list[str], output_path: str) -> None:
    list_path = Path(output_path).with_suffix(".txt")
    list_path.write_text("\n".join(f"file '{Path(p).as_posix()}'" for p in paths) + "\n")
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_path),
        "-c", "copy", "-movflags", "+faststart", output_path,
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _publish_test_output(path: str, job_id: str) -> str:
    """Copy the final MP4 to a temporary Modal Volume for browser playback."""
    target = Path(OUTPUT_ROOT) / f"{job_id}.mp4"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    output_cache.commit()
    return str(target)


@app.function(
    image=modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub>=0.35.0", "hf_transfer>=0.1.9"),
    volumes={CACHE_ROOT: model_cache},
    secrets=[runtime_secret],
    timeout=7200,
)
def prefetch_models():
    """Download the gated LTX-2.5 Diffusers repo on CPU, not a paid GPU."""
    from huggingface_hub import snapshot_download
    os.environ["HF_HOME"] = CACHE_ROOT
    path = snapshot_download(
        MODEL_REPO,
        cache_dir=CACHE_ROOT,
        token=os.environ.get("HF_TOKEN"),
        ignore_patterns=["transformer_full/*"],
    )
    model_cache.commit()
    print(f"Cached {MODEL_REPO} at {path}")


@app.cls(
    image=gpu_image,
    gpu="B200",
    volumes={CACHE_ROOT: model_cache, OUTPUT_ROOT: output_cache},
    secrets=[runtime_secret],
    timeout=3600,
    min_containers=0,
    max_containers=1,
    scaledown_window=30,
)
class LTXWorker:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import LTX2Pipeline, LTX2LatentUpsamplePipeline
        from diffusers.pipelines.ltx2.latent_upsampler import LTX2LatentUpsamplerModel

        token = os.environ.get("HF_TOKEN")
        self.pipe = LTX2Pipeline.from_pretrained(
            MODEL_REPO,
            torch_dtype=torch.bfloat16,
            cache_dir=CACHE_ROOT,
            token=token,
        )
        self.pipe.to("cuda")
        self.pipe.vae.enable_tiling()

        self.upsampler_model = LTX2LatentUpsamplerModel.from_pretrained(
            MODEL_REPO,
            subfolder="latent_upsampler",
            torch_dtype=torch.bfloat16,
            cache_dir=CACHE_ROOT,
            token=token,
        ).to("cuda")
        self.upsample_pipe = LTX2LatentUpsamplePipeline(vae=self.pipe.vae, latent_upsampler=self.upsampler_model)

    def _render_clip(self, prompt: str, aspect: str, quality: str, duration: int, native_audio: bool, seed: int, out_dir: str, index: int) -> str:
        import torch
        from diffusers.pipelines.ltx2.utils import DISTILLED_SIGMA_VALUES, STAGE_2_DISTILLED_SIGMA_VALUES, DEFAULT_NEGATIVE_PROMPT
        from diffusers.utils import encode_video

        source_w, source_h, target_w, target_h = _dimensions(aspect, quality)
        fps = 24.0
        num_frames = int(duration * fps) + 1
        generator = torch.Generator("cuda").manual_seed(seed + index)
        raw_path = str(Path(out_dir) / f"raw-{index}.mp4")
        cropped_path = str(Path(out_dir) / f"clip-{index}.mp4")

        if quality == "1080p":
            video_latent, audio_latent = self.pipe(
                prompt=prompt,
                negative_prompt=DEFAULT_NEGATIVE_PROMPT,
                width=source_w,
                height=source_h,
                num_frames=num_frames,
                frame_rate=fps,
                num_inference_steps=8,
                sigmas=DISTILLED_SIGMA_VALUES,
                guidance_scale=1.0,
                generator=generator,
                output_type="latent",
                return_dict=False,
            )
            upscaled_video_latent = self.upsample_pipe(
                latents=video_latent,
                output_type="latent",
                return_dict=False,
            )[0]
            video, audio = self.pipe(
                latents=upscaled_video_latent,
                audio_latents=audio_latent,
                prompt=prompt,
                num_inference_steps=3,
                noise_scale=STAGE_2_DISTILLED_SIGMA_VALUES[0],
                sigmas=STAGE_2_DISTILLED_SIGMA_VALUES,
                generator=generator,
                guidance_scale=1.0,
                output_type="np",
                return_dict=False,
            )
        else:
            video, audio = self.pipe(
                prompt=prompt,
                negative_prompt=DEFAULT_NEGATIVE_PROMPT,
                width=source_w,
                height=source_h,
                num_frames=num_frames,
                frame_rate=fps,
                num_inference_steps=8,
                sigmas=DISTILLED_SIGMA_VALUES,
                guidance_scale=1.0,
                generator=generator,
                output_type="np",
                return_dict=False,
            )

        encode_video(
            video[0], fps=fps,
            audio=audio[0].float().cpu() if native_audio else None,
            audio_sample_rate=self.pipe.vocoder.config.output_sampling_rate,
            output_path=raw_path,
        )
        _crop(raw_path, cropped_path, target_w, target_h)
        return cropped_path

    @modal.method()
    def generate(self, request: dict[str, Any]) -> dict[str, Any]:
        job_id = request["jobId"]
        started = time.time()
        temp_dir = tempfile.mkdtemp(prefix=f"triven-{job_id}-")
        try:
            _set_job(job_id, status="GENERATING", progress=8, message="B200 started; loading LTX-2.5")
            mode = request.get("mode", "DIRECT")
            clips: list[str] = []
            if mode == "SCENES":
                scenes = request.get("scenes") or []
                total = max(1, len(scenes))
                for i, scene in enumerate(scenes):
                    progress = 12 + int((i / total) * 68)
                    _set_job(job_id, status="GENERATING", progress=progress, message=f"Rendering scene {i + 1} of {total}")
                    clips.append(self._render_clip(
                        prompt=scene["prompt"],
                        aspect=request["aspectRatio"],
                        quality=request["quality"],
                        duration=int(scene.get("duration", 5)),
                        native_audio=bool(request.get("nativeAudio", True)),
                        seed=int(request.get("seed", 42)),
                        out_dir=temp_dir,
                        index=i,
                    ))
            else:
                direct_duration = int(request.get("durationSeconds", 5))
                if direct_duration > 20:
                    raise ValueError("Direct LTX generation is limited to 20 seconds in Triven Cinema. Use Create scenes for longer videos; the app will render each <=15 second scene and stitch them together.")
                _set_job(job_id, status="GENERATING", progress=20, message="Rendering video")
                clips.append(self._render_clip(
                    prompt=request["prompt"],
                    aspect=request["aspectRatio"],
                    quality=request["quality"],
                    duration=direct_duration,
                    native_audio=bool(request.get("nativeAudio", True)),
                    seed=int(request.get("seed", 42)),
                    out_dir=temp_dir,
                    index=0,
                ))

            final_path = str(Path(temp_dir) / "final.mp4")
            _set_job(job_id, status="STITCHING", progress=84, message="Composing final MP4")
            if len(clips) == 1:
                shutil.copy2(clips[0], final_path)
            else:
                _concat(clips, final_path)

            _set_job(job_id, status="UPLOADING", progress=93, message="Preparing video for playback")
            output_path = _publish_test_output(final_path, job_id)
            gpu_seconds = time.time() - started
            actual_cost = gpu_seconds * B200_PRICE_PER_SECOND
            result = {
                "jobId": job_id,
                "status": "COMPLETED",
                "progress": 100,
                "message": "Render complete",
                "outputPath": output_path,
                "gpuSeconds": gpu_seconds,
                "actualCost": actual_cost,
            }
            _set_job(job_id, **result)
            return result
        except Exception as exc:
            gpu_seconds = time.time() - started
            _set_job(job_id, status="FAILED", progress=0, message="Render failed", error=str(exc), gpuSeconds=gpu_seconds, actualCost=gpu_seconds * B200_PRICE_PER_SECOND)
            raise
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


@app.function(image=web_image, secrets=[runtime_secret], volumes={OUTPUT_ROOT: output_cache})
@modal.asgi_app()
def api():
    from fastapi import FastAPI, Header, HTTPException, Request
    from fastapi.responses import FileResponse
    service = FastAPI(title="Triven Cinema GPU API")

    @service.get("/health")
    def health():
        return {"ok": True, "model": "LTX-2.5", "gpu": "B200"}

    @service.post("/submit")
    def submit(payload: dict[str, Any], x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        job_id = str(payload.get("jobId", "")).strip()
        if not job_id:
            raise HTTPException(status_code=400, detail="jobId is required")
        _set_job(job_id, status="QUEUED", progress=3, message="Queued for B200")
        call = LTXWorker().generate.spawn(payload)
        return {"jobId": job_id, "callId": call.object_id}

    @service.get("/status/{job_id}")
    def status(job_id: str, request: Request, x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        state = jobs.get(job_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Job not found")
        state = dict(state)
        if state.get("status") == "COMPLETED" and state.get("outputPath"):
            state["outputUrl"] = str(request.base_url).rstrip("/") + f"/video/{job_id}"
        return state

    @service.get("/video/{job_id}")
    def video(job_id: str):
        # Test-only public playback endpoint. The video file lives in a Modal Volume,
        # not PostgreSQL or Cloudflare R2.
        output_cache.reload()
        path = Path(OUTPUT_ROOT) / f"{job_id}.mp4"
        if not path.exists():
            raise HTTPException(status_code=404, detail="Video not found")
        return FileResponse(
            path,
            media_type="video/mp4",
            filename=f"triven-cinema-{job_id}.mp4",
            headers={"Cache-Control": "no-store"},
        )

    return service
