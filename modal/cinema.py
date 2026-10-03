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


def _job_cancelled(job_id: str) -> bool:
    return bool(dict(jobs.get(job_id, {})).get("cancelled"))


def _normalize_render_mode(value: str) -> str:
    return value if value in {"fast", "pro"} else "fast"


def _normalize_resolution(value: str) -> str:
    aliases = {"2160p": "4k", "4K": "4k"}
    value = aliases.get(value, value)
    return value if value in {"720p", "1080p", "1440p", "4k"} else "1080p"


def _normalize_fps(value: Any) -> int:
    try:
        fps = int(value)
    except (TypeError, ValueError):
        return 24
    return fps if fps in {24, 25, 30, 48, 50} else 24


def _normalize_audio_quality(value: str, native_audio: bool) -> str:
    if not native_audio:
        return "off"
    return value if value in {"standard", "high"} else "standard"


def _profile_label(render_mode: str, resolution: str, fps: int, audio_quality: str) -> str:
    mode = "Pro" if render_mode == "pro" else "Fast"
    resolution_label = "4K" if resolution == "4k" else resolution
    audio = "Audio off" if audio_quality == "off" else "Native HQ audio" if audio_quality == "high" else "Native audio"
    return f"{mode} | {resolution_label} | {fps} FPS | {audio}"


def _render_geometry(aspect: str, resolution: str) -> tuple[int, int, int, int, int]:
    """Return source width/height, final width/height, and x2 latent upscale count."""
    resolution = _normalize_resolution(resolution)
    mappings = {
        "720p": {
            "16:9": (1280, 736, 1280, 720, 0),
            "9:16": (736, 1280, 720, 1280, 0),
            "1:1": (736, 736, 720, 720, 0),
        },
        "1080p": {
            "16:9": (960, 544, 1920, 1080, 1),
            "9:16": (544, 960, 1080, 1920, 1),
            "1:1": (544, 544, 1080, 1080, 1),
        },
        "1440p": {
            "16:9": (1280, 736, 2560, 1440, 1),
            "9:16": (736, 1280, 1440, 2560, 1),
            "1:1": (736, 736, 1440, 1440, 1),
        },
        "4k": {
            "16:9": (960, 544, 3840, 2160, 2),
            "9:16": (544, 960, 2160, 3840, 2),
            "1:1": (544, 544, 2160, 2160, 2),
        },
    }
    safe_aspect = aspect if aspect in {"16:9", "9:16", "1:1"} else "16:9"
    return mappings[resolution][safe_aspect]


def _frame_count(duration: int, fps: int) -> int:
    # LTX video frame counts live on the causal VAE grid: (frames - 1) % 8 == 0.
    requested_intervals = max(1, int(round((duration * fps) / 8.0)))
    return requested_intervals * 8 + 1


def _max_clip_seconds(render_mode: str, resolution: str, fps: int) -> int:
    # Conservative production limits. High resolution, Pro and high-FPS shots are split into scenes.
    if render_mode == "pro" or resolution in {"1440p", "4k"} or fps >= 30:
        return 10
    return 20


def _video_crf(render_mode: str, resolution: str) -> str:
    if render_mode == "pro":
        return "14" if resolution in {"1440p", "4k"} else "15"
    return "16" if resolution in {"1440p", "4k"} else "18"


def _audio_bitrate(audio_quality: str) -> str:
    return "320k" if audio_quality == "high" else "192k"


def _crop(
    input_path: str,
    output_path: str,
    width: int,
    height: int,
    render_mode: str,
    resolution: str,
    audio_quality: str,
) -> None:
    command = [
        "ffmpeg", "-y", "-i", input_path,
        "-vf", f"crop={width}:{height}",
        "-c:v", "libx264", "-preset", "medium", "-crf", _video_crf(render_mode, resolution),
    ]
    if audio_quality == "off":
        command += ["-an"]
    else:
        command += ["-c:a", "aac", "-b:a", _audio_bitrate(audio_quality)]
    command += ["-movflags", "+faststart", output_path]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


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
    """Cache both the distilled Fast transformer and the full/SFT Pro transformer on CPU storage."""
    from huggingface_hub import snapshot_download

    os.environ["HF_HOME"] = CACHE_ROOT
    token = os.environ.get("HF_TOKEN")

    base_path = snapshot_download(
        MODEL_REPO,
        cache_dir=CACHE_ROOT,
        token=token,
        ignore_patterns=["transformer_full/*"],
    )
    snapshot_download(
        MODEL_REPO,
        cache_dir=CACHE_ROOT,
        token=token,
        allow_patterns=["transformer_full/*"],
    )
    model_cache.commit()
    print(f"Cached LTX-2.5 Fast and Pro components at {base_path}")


@app.cls(
    image=gpu_image,
    gpu="B200",
    volumes={CACHE_ROOT: model_cache, OUTPUT_ROOT: output_cache},
    secrets=[runtime_secret],
    timeout=7200,
    min_containers=0,
    max_containers=1,
    scaledown_window=30,
)
class LTXWorker:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import FlowMatchEulerDiscreteScheduler, LTX2LatentUpsamplePipeline, LTX2Pipeline
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

        self.fast_transformer = self.pipe.transformer
        self.fast_scheduler = self.pipe.scheduler
        self.pro_transformer = None
        self.pro_scheduler = None
        self.scheduler_cls = FlowMatchEulerDiscreteScheduler
        self.token = token

        self.upsampler_model = LTX2LatentUpsamplerModel.from_pretrained(
            MODEL_REPO,
            subfolder="latent_upsampler",
            torch_dtype=torch.bfloat16,
            cache_dir=CACHE_ROOT,
            token=token,
        ).to("cuda")
        self.upsample_pipe = LTX2LatentUpsamplePipeline(vae=self.pipe.vae, latent_upsampler=self.upsampler_model)

    def _ensure_pro(self) -> None:
        if self.pro_transformer is not None:
            return

        import torch
        from diffusers import LTX2VideoTransformer3DModel

        self.pro_transformer = LTX2VideoTransformer3DModel.from_pretrained(
            MODEL_REPO,
            subfolder="transformer_full",
            torch_dtype=torch.bfloat16,
            cache_dir=CACHE_ROOT,
            token=self.token,
        ).to("cuda")
        self.pro_scheduler = self.scheduler_cls.from_config(
            self.fast_scheduler.config,
            use_dynamic_shifting=True,
            shift_terminal=0.1,
        )

    def _activate_mode(self, render_mode: str) -> None:
        if render_mode == "pro":
            self._ensure_pro()
            self.pipe.transformer = self.pro_transformer
            self.pipe.scheduler = self.pro_scheduler
        else:
            self.pipe.transformer = self.fast_transformer
            self.pipe.scheduler = self.fast_scheduler

    def _fast_kwargs(self) -> dict[str, Any]:
        from diffusers.pipelines.ltx2.utils import DISTILLED_SIGMA_VALUES

        return {
            "sigmas": DISTILLED_SIGMA_VALUES,
            "guidance_scale": 1.0,
            "audio_guidance_scale": 1.0,
            "stg_scale": 0.0,
            "audio_stg_scale": 0.0,
            "modality_scale": 1.0,
            "audio_modality_scale": 1.0,
            "guidance_rescale": 0.0,
            "audio_guidance_rescale": 0.0,
            "spatio_temporal_guidance_blocks": None,
        }

    def _pro_kwargs(self) -> dict[str, Any]:
        return {
            "num_inference_steps": 30,
            "guidance_scale": 3.0,
            "stg_scale": 1.0,
            "modality_scale": 3.0,
            "guidance_rescale": 0.7,
            "audio_guidance_scale": 7.0,
            "audio_stg_scale": 1.0,
            "audio_modality_scale": 3.0,
            "audio_guidance_rescale": 0.7,
            "spatio_temporal_guidance_blocks": [28],
            "use_cross_timestep": True,
        }

    def _render_clip(
        self,
        prompt: str,
        aspect: str,
        render_mode: str,
        resolution: str,
        fps: int,
        duration: int,
        audio_quality: str,
        seed: int,
        out_dir: str,
        index: int,
    ) -> str:
        import torch
        from diffusers.pipelines.ltx2.utils import DEFAULT_NEGATIVE_PROMPT, STAGE_2_DISTILLED_SIGMA_VALUES
        from diffusers.utils import encode_video

        render_mode = _normalize_render_mode(render_mode)
        resolution = _normalize_resolution(resolution)
        fps = _normalize_fps(fps)
        source_w, source_h, target_w, target_h, upscale_count = _render_geometry(aspect, resolution)
        num_frames = _frame_count(duration, fps)
        generator = torch.Generator("cuda").manual_seed(seed + index)
        raw_path = str(Path(out_dir) / f"raw-{index}.mp4")
        cropped_path = str(Path(out_dir) / f"clip-{index}.mp4")

        self._activate_mode(render_mode)
        stage_one = self._pro_kwargs() if render_mode == "pro" else self._fast_kwargs()

        if upscale_count == 0:
            video, audio = self.pipe(
                prompt=prompt,
                negative_prompt=DEFAULT_NEGATIVE_PROMPT,
                width=source_w,
                height=source_h,
                num_frames=num_frames,
                frame_rate=float(fps),
                generator=generator,
                output_type="np",
                return_dict=False,
                **stage_one,
            )
        else:
            video_latent, audio_latent = self.pipe(
                prompt=prompt,
                negative_prompt=DEFAULT_NEGATIVE_PROMPT,
                width=source_w,
                height=source_h,
                num_frames=num_frames,
                frame_rate=float(fps),
                generator=generator,
                output_type="latent",
                return_dict=False,
                **stage_one,
            )

            upscaled_video_latent = video_latent
            for _ in range(upscale_count):
                upscaled_video_latent = self.upsample_pipe(
                    latents=upscaled_video_latent,
                    output_type="latent",
                    return_dict=False,
                )[0]

            # The reference two-stage refinement is distilled, even when the creative pass used Full/SFT.
            self._activate_mode("fast")
            video, audio = self.pipe(
                latents=upscaled_video_latent,
                audio_latents=audio_latent,
                prompt=prompt,
                frame_rate=float(fps),
                num_inference_steps=3,
                noise_scale=STAGE_2_DISTILLED_SIGMA_VALUES[0],
                sigmas=STAGE_2_DISTILLED_SIGMA_VALUES,
                generator=generator,
                guidance_scale=1.0,
                audio_guidance_scale=1.0,
                stg_scale=0.0,
                audio_stg_scale=0.0,
                modality_scale=1.0,
                audio_modality_scale=1.0,
                guidance_rescale=0.0,
                audio_guidance_rescale=0.0,
                spatio_temporal_guidance_blocks=None,
                output_type="np",
                return_dict=False,
            )

        encode_video(
            video[0],
            fps=float(fps),
            audio=audio[0].float().cpu() if audio_quality != "off" else None,
            audio_sample_rate=self.pipe.vocoder.config.output_sampling_rate,
            output_path=raw_path,
        )
        _crop(raw_path, cropped_path, target_w, target_h, render_mode, resolution, audio_quality)
        return cropped_path

    @modal.method()
    def generate(self, request: dict[str, Any]) -> dict[str, Any]:
        job_id = request["jobId"]
        started = time.time()
        temp_dir = tempfile.mkdtemp(prefix=f"triven-{job_id}-")
        try:
            render_mode = _normalize_render_mode(str(request.get("renderMode", "fast")))
            resolution = _normalize_resolution(str(request.get("resolution", "1080p")))
            fps = _normalize_fps(request.get("fps", 24))
            audio_quality = _normalize_audio_quality(
                str(request.get("audioQuality", "standard")),
                bool(request.get("nativeAudio", True)),
            )
            profile = _profile_label(render_mode, resolution, fps, audio_quality)
            clip_limit = _max_clip_seconds(render_mode, resolution, fps)

            _set_job(job_id, status="GENERATING", progress=8, message=f"B200 started | {profile} | loading LTX-2.5")
            mode = request.get("mode", "DIRECT")
            clips: list[str] = []

            if mode == "SCENES":
                scenes = request.get("scenes") or []
                total = max(1, len(scenes))
                for i, scene in enumerate(scenes):
                    if _job_cancelled(job_id):
                        raise RuntimeError("Generation stopped by user")
                    scene_duration = int(scene.get("duration", 5))
                    if scene_duration > clip_limit:
                        raise ValueError(
                            f"This render profile supports up to {clip_limit}s per scene. "
                            f"Scene {i + 1} is {scene_duration}s; split it into shorter scenes."
                        )
                    progress = 12 + int((i / total) * 68)
                    _set_job(job_id, status="GENERATING", progress=progress, message=f"Rendering scene {i + 1} of {total} | {profile}")
                    clips.append(self._render_clip(
                        prompt=scene["prompt"],
                        aspect=request["aspectRatio"],
                        render_mode=render_mode,
                        resolution=resolution,
                        fps=fps,
                        duration=scene_duration,
                        audio_quality=audio_quality,
                        seed=int(request.get("seed", 42)),
                        out_dir=temp_dir,
                        index=i,
                    ))
            else:
                direct_duration = int(request.get("durationSeconds", 5))
                if direct_duration > clip_limit:
                    raise ValueError(
                        f"{profile} supports up to {clip_limit}s per direct clip in Triven Cinema. "
                        "Use scene mode for longer videos."
                    )
                _set_job(job_id, status="GENERATING", progress=20, message=f"Rendering video | {profile}")
                clips.append(self._render_clip(
                    prompt=request["prompt"],
                    aspect=request["aspectRatio"],
                    render_mode=render_mode,
                    resolution=resolution,
                    fps=fps,
                    duration=direct_duration,
                    audio_quality=audio_quality,
                    seed=int(request.get("seed", 42)),
                    out_dir=temp_dir,
                    index=0,
                ))

            if _job_cancelled(job_id):
                raise RuntimeError("Generation stopped by user")

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
                "message": f"Render complete | {profile}",
                "outputPath": output_path,
                "gpuSeconds": gpu_seconds,
                "actualCost": actual_cost,
            }
            _set_job(job_id, **result)
            return result
        except Exception as exc:
            gpu_seconds = time.time() - started
            if _job_cancelled(job_id):
                _set_job(
                    job_id,
                    status="FAILED",
                    message="Generation stopped by user",
                    error=None,
                    gpuSeconds=gpu_seconds,
                    actualCost=gpu_seconds * B200_PRICE_PER_SECOND,
                    cancelled=True,
                )
                return dict(jobs.get(job_id, {}))
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
        return {"ok": True, "model": "LTX-2.5", "gpu": "B200", "modes": ["fast", "pro"], "resolutions": ["720p", "1080p", "1440p", "4k"], "fps": [24, 25, 30, 48, 50]}

    @service.post("/submit")
    def submit(payload: dict[str, Any], x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        job_id = str(payload.get("jobId", "")).strip()
        if not job_id:
            raise HTTPException(status_code=400, detail="jobId is required")
        _set_job(job_id, status="QUEUED", progress=3, message="Queued for B200", cancelled=False)
        call = LTXWorker().generate.spawn(payload)
        _set_job(job_id, callId=call.object_id)
        return {"jobId": job_id, "callId": call.object_id}

    @service.post("/cancel/{job_id}")
    def cancel(job_id: str, x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        state = jobs.get(job_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Job not found")

        state = dict(state)
        if state.get("status") in {"COMPLETED", "FAILED"}:
            return state

        call_id = state.get("callId")
        if not call_id:
            raise HTTPException(status_code=409, detail="GPU call is still starting")

        try:
            modal.FunctionCall.from_id(str(call_id)).cancel(terminate_containers=False)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not cancel GPU call: {exc}") from exc

        _set_job(
            job_id,
            status="FAILED",
            message="Generation stopped by user",
            error=None,
            cancelled=True,
        )
        return dict(jobs.get(job_id, {}))

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
