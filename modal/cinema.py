"""Triven Cinema production-oriented Modal backend.

Deploy:
  modal deploy modal/cinema.py

Prefetch LTX-2.5 Fast + Pro weights:
  modal run modal/cinema.py::prefetch_models

Prefetch the Story Director / semantic reviewer (one-time):
  modal run modal/cinema.py::prefetch_director

Required Modal Secret: triven-cinema-runtime
  HF_TOKEN
  TRIVEN_WEB_SECRET

Optional S3-compatible production storage keys in the same secret:
  STORAGE_S3_ENDPOINT
  STORAGE_S3_ACCESS_KEY_ID
  STORAGE_S3_SECRET_ACCESS_KEY
  STORAGE_S3_BUCKET
  STORAGE_PUBLIC_BASE_URL

When S3-compatible storage is not configured, outputs remain in a Modal Volume.
"""

import hashlib
import hmac
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

import modal

APP_NAME = "triven-cinema"
MODEL_REPO = "Lightricks/LTX-2.5-Diffusers"
DIRECTOR_MODEL_REPO = os.environ.get("STORY_DIRECTOR_MODEL", "Qwen/Qwen3-VL-4B-Instruct")
CACHE_ROOT = "/cache/huggingface"
OUTPUT_ROOT = "/outputs"
B200_PRICE_PER_SECOND = float(os.environ.get("B200_PRICE_PER_SECOND", "0.001736"))

app = modal.App(APP_NAME)
model_cache = modal.Volume.from_name("triven-cinema-model-cache", create_if_missing=True)
output_cache = modal.Volume.from_name("triven-cinema-output-cache", create_if_missing=True)
jobs = modal.Dict.from_name("triven-cinema-jobs", create_if_missing=True)
edit_jobs = modal.Dict.from_name("triven-cinema-edit-jobs", create_if_missing=True)
runtime_secret = modal.Secret.from_name("triven-cinema-runtime")

web_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi>=0.118.0")

editor_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .pip_install("boto3>=1.40.0")
)

gpu_image = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04", add_python="3.12")
    .apt_install("ffmpeg", "git", "build-essential", "gcc", "g++", "ninja-build", "fonts-dejavu-core")
    .env({"CC": "/usr/bin/gcc", "CXX": "/usr/bin/g++"})
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
        "hf_transfer>=0.1.9",
        "av>=15.1.0",
        "imageio-ffmpeg>=0.6.0",
        "pillow>=11.0.0",
    )
    .env({"HF_HOME": CACHE_ROOT, "HF_HUB_ENABLE_HF_TRANSFER": "1"})
)




def _extract_json_object(text: str) -> dict[str, Any]:
    clean = text.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean, flags=re.I | re.S).strip()
    start = clean.find("{")
    end = clean.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Director did not return a JSON object")
    return json.loads(clean[start:end + 1])


def _contact_sheet(input_path: str, output_path: str, duration: int) -> str:
    interval = max(0.5, float(duration) / 3.0)
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path,
        "-vf", f"fps=1/{interval:.3f},scale=384:-2,tile=3x1",
        "-frames:v", "1", output_path,
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return output_path


def _story_negative_prompt(extra: str | None = None) -> str:
    base = (
        "visible text, subtitles, captions, letters, words, typography, logos, watermarks, UI, speech bubbles, "
        "random signage, unrelated characters, duplicate people, identity drift, wardrobe changes, extra limbs, "
        "malformed hands, deformed faces, flicker, frame tearing"
    )
    return f"{base}, {extra}" if extra else base


def _auth(secret: str | None) -> None:
    expected = os.environ.get("TRIVEN_WEB_SECRET", "")
    if not expected or secret != expected:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Unauthorized")


def _media_token(kind: str, *parts: str) -> str:
    secret = os.environ.get("TRIVEN_WEB_SECRET", "")
    if not secret:
        return ""
    payload = "|".join([kind, *parts]).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def _require_media_token(token: str | None, kind: str, *parts: str) -> None:
    expected = _media_token(kind, *parts)
    if not token or not expected or not hmac.compare_digest(token, expected):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid media token")


def _signed_media_url(base: str, path: str, kind: str, *parts: str) -> str:
    token = _media_token(kind, *parts)
    separator = "&" if "?" in path else "?"
    return f"{base}{path}{separator}token={token}"


def _set_job(job_id: str, **values: Any) -> None:
    current = dict(jobs.get(job_id, {}))
    current.update(values)
    current["jobId"] = job_id
    current["updatedAt"] = time.time()
    jobs[job_id] = current


def _set_edit(version_id: str, **values: Any) -> None:
    current = dict(edit_jobs.get(version_id, {}))
    current.update(values)
    current["versionId"] = version_id
    current["updatedAt"] = time.time()
    edit_jobs[version_id] = current


def _job_cancelled(job_id: str) -> bool:
    state = dict(jobs.get(job_id, {}))
    return bool(state.get("cancelled") or state.get("cancelRequested"))


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
    # 24/25/48/50 are official LTX-2.5 hosted profiles. 30 remains available for
    # this self-hosted Diffusers path as an experimental compatibility option.
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
    requested_intervals = max(1, int(round((duration * fps) / 8.0)))
    return requested_intervals * 8 + 1


def _max_clip_seconds(render_mode: str, resolution: str, fps: int) -> int:
    if render_mode == "pro" or resolution in {"1440p", "4k"} or fps >= 30:
        return 10
    return 20


def _video_crf(render_mode: str, resolution: str) -> str:
    if render_mode == "pro":
        return "14" if resolution in {"1440p", "4k"} else "15"
    return "16" if resolution in {"1440p", "4k"} else "18"


def _audio_bitrate(audio_quality: str) -> str:
    return "320k" if audio_quality == "high" else "192k"


def _crop(input_path: str, output_path: str, width: int, height: int, render_mode: str, resolution: str, audio_quality: str) -> None:
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


def _extract_last_frame(input_path: str, output_path: str) -> str:
    subprocess.run([
        "ffmpeg", "-y", "-sseof", "-0.08", "-i", input_path,
        "-frames:v", "1", "-q:v", "2", output_path,
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return output_path


def _concat(paths: list[str], output_path: str) -> None:
    list_path = Path(output_path).with_suffix(".txt")
    list_path.write_text("\n".join(f"file '{Path(p).as_posix()}'" for p in paths) + "\n")
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_path),
        "-c", "copy", "-movflags", "+faststart", output_path,
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _probe(path: str) -> dict[str, Any]:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path,
    ], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def _parse_float(pattern: str, text: str) -> float | None:
    match = re.search(pattern, text, re.I)
    if not match:
        return None
    try:
        return float(match.group(1))
    except (TypeError, ValueError):
        return None


def _analyze_video(path: str, expected_duration: float | None = None) -> dict[str, Any]:
    """Technical QC: codec/timing + sampled pixel statistics + black/freeze/silence checks."""
    probe = _probe(path)
    streams = probe.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    fmt = probe.get("format", {})
    duration = float(fmt.get("duration") or video.get("duration") or 0)

    fps = 0.0
    rate = str(video.get("avg_frame_rate") or "0/1")
    try:
        num, den = rate.split("/", 1)
        fps = float(num) / max(1.0, float(den))
    except (ValueError, ZeroDivisionError):
        fps = 0.0

    def filter_stderr(filter_expr: str) -> str:
        result = subprocess.run([
            "ffmpeg", "-hide_banner", "-nostats", "-i", path, "-vf", filter_expr, "-an", "-f", "null", "-",
        ], capture_output=True, text=True)
        return result.stderr

    black_text = filter_stderr("blackdetect=d=0.25:pix_th=0.10")
    freeze_text = filter_stderr("freezedetect=n=-60dB:d=0.8")
    black_segments = len(re.findall(r"black_start:", black_text))
    freeze_segments = len(re.findall(r"freeze_start:", freeze_text))

    silence_segments = 0
    mean_volume = None
    max_volume = None
    if audio:
        silence = subprocess.run([
            "ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "silencedetect=n=-50dB:d=0.6", "-f", "null", "-",
        ], capture_output=True, text=True).stderr
        silence_segments = len(re.findall(r"silence_start:", silence))
        volume = subprocess.run([
            "ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "volumedetect", "-f", "null", "-",
        ], capture_output=True, text=True).stderr
        mean_volume = _parse_float(r"mean_volume:\s*(-?[\d.]+)\s*dB", volume)
        max_volume = _parse_float(r"max_volume:\s*(-?[\d.]+)\s*dB", volume)

    stats_file = Path(tempfile.mkdtemp(prefix="triven-qc-")) / "signalstats.txt"
    try:
        subprocess.run([
            "ffmpeg", "-hide_banner", "-nostats", "-i", path,
            "-vf", f"fps=1,signalstats,metadata=print:file={stats_file}",
            "-an", "-f", "null", "-",
        ], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        stats_text = stats_file.read_text(errors="ignore") if stats_file.exists() else ""
        y_values = [float(value) for value in re.findall(r"lavfi\.signalstats\.YAVG=([\d.]+)", stats_text)]
        sat_values = [float(value) for value in re.findall(r"lavfi\.signalstats\.SATAVG=([\d.]+)", stats_text)]
        luma = sum(y_values) / len(y_values) if y_values else None
        saturation = sum(sat_values) / len(sat_values) if sat_values else None
    finally:
        shutil.rmtree(stats_file.parent, ignore_errors=True)

    issues: list[dict[str, str]] = []
    score = 100
    if not video:
        issues.append({"code": "NO_VIDEO", "severity": "error", "message": "No video stream was found."})
        score -= 60
    if expected_duration and abs(duration - expected_duration) > max(1.2, expected_duration * 0.08):
        issues.append({"code": "DURATION_MISMATCH", "severity": "warning", "message": f"Output duration {duration:.2f}s differs from the requested {expected_duration:.2f}s."})
        score -= 8
    if black_segments:
        issues.append({"code": "BLACK_SEGMENTS", "severity": "warning", "message": f"Detected {black_segments} black-frame segment(s)."})
        score -= min(20, black_segments * 5)
    if freeze_segments:
        issues.append({"code": "FREEZE_SEGMENTS", "severity": "warning", "message": f"Detected {freeze_segments} possible frozen-motion segment(s)."})
        score -= min(20, freeze_segments * 4)
    if audio and silence_segments > 2:
        issues.append({"code": "LONG_SILENCE", "severity": "info", "message": f"Detected {silence_segments} silence segment(s); review whether they are intentional."})
        score -= min(8, silence_segments)
    if audio and max_volume is not None and max_volume > -0.2:
        issues.append({"code": "AUDIO_NEAR_CLIP", "severity": "warning", "message": "Audio peaks are close to digital clipping."})
        score -= 5
    if luma is not None and (luma < 28 or luma > 225):
        issues.append({"code": "EXTREME_LUMA", "severity": "warning", "message": "Sampled frames are extremely dark or bright; inspect exposure."})
        score -= 6
    if not issues:
        issues.append({"code": "TECHNICAL_PASS", "severity": "info", "message": "No major technical defects were detected by automated QC."})

    return {
        "technicalScore": max(0, min(100, score)),
        "durationSeconds": duration,
        "width": video.get("width"),
        "height": video.get("height"),
        "fps": round(fps, 3),
        "videoCodec": video.get("codec_name"),
        "audioCodec": audio.get("codec_name") if audio else None,
        "audioChannels": audio.get("channels") if audio else None,
        "meanVolumeDb": mean_volume,
        "maxVolumeDb": max_volume,
        "sampledLumaAverage": round(luma, 3) if luma is not None else None,
        "sampledSaturationAverage": round(saturation, 3) if saturation is not None else None,
        "blackSegments": black_segments,
        "freezeSegments": freeze_segments,
        "silenceSegments": silence_segments,
        "fileSizeBytes": Path(path).stat().st_size,
        "issues": issues,
    }


def _make_thumbnail(video_path: str, output_path: str) -> None:
    probe = _probe(video_path)
    duration = float(probe.get("format", {}).get("duration") or 1.0)
    at = max(0.1, min(duration * 0.35, max(0.1, duration - 0.1)))
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y", "-ss", f"{at:.3f}", "-i", video_path, "-frames:v", "1", "-q:v", "2", output_path,
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _storage_config() -> dict[str, str] | None:
    endpoint = os.environ.get("STORAGE_S3_ENDPOINT")
    key = os.environ.get("STORAGE_S3_ACCESS_KEY_ID")
    secret = os.environ.get("STORAGE_S3_SECRET_ACCESS_KEY")
    bucket = os.environ.get("STORAGE_S3_BUCKET")
    public = os.environ.get("STORAGE_PUBLIC_BASE_URL")
    if all([endpoint, key, secret, bucket, public]):
        return {"endpoint": endpoint, "key": key, "secret": secret, "bucket": bucket, "public": public.rstrip("/")}
    return None


def _upload_if_configured(path: str, key_name: str, content_type: str) -> str | None:
    config = _storage_config()
    if not config:
        return None
    import boto3
    client = boto3.client(
        "s3",
        endpoint_url=config["endpoint"],
        aws_access_key_id=config["key"],
        aws_secret_access_key=config["secret"],
    )
    client.upload_file(path, config["bucket"], key_name, ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=31536000, immutable"})
    return f"{config['public']}/{key_name}"


def _delete_storage_prefix(prefix: str) -> None:
    config = _storage_config()
    if not config:
        return
    import boto3
    client = boto3.client(
        "s3",
        endpoint_url=config["endpoint"],
        aws_access_key_id=config["key"],
        aws_secret_access_key=config["secret"],
    )
    continuation: str | None = None
    while True:
        kwargs: dict[str, Any] = {"Bucket": config["bucket"], "Prefix": prefix}
        if continuation:
            kwargs["ContinuationToken"] = continuation
        response = client.list_objects_v2(**kwargs)
        objects = [{"Key": item["Key"]} for item in response.get("Contents", []) if item.get("Key")]
        if objects:
            client.delete_objects(Bucket=config["bucket"], Delete={"Objects": objects, "Quiet": True})
        if not response.get("IsTruncated"):
            break
        continuation = response.get("NextContinuationToken")
        if not continuation:
            break


def _publish_master(path: str, job_id: str) -> tuple[str, str, str | None, str | None]:
    directory = Path(OUTPUT_ROOT) / job_id
    directory.mkdir(parents=True, exist_ok=True)
    video_target = directory / "master.mp4"
    thumb_target = directory / "thumbnail.jpg"
    shutil.copy2(path, video_target)
    _make_thumbnail(str(video_target), str(thumb_target))
    output_cache.commit()
    remote_video = _upload_if_configured(str(video_target), f"generations/{job_id}/master.mp4", "video/mp4")
    remote_thumb = _upload_if_configured(str(thumb_target), f"generations/{job_id}/thumbnail.jpg", "image/jpeg")
    return str(video_target), str(thumb_target), remote_video, remote_thumb


@app.function(
    image=editor_image,
    volumes={OUTPUT_ROOT: output_cache},
    secrets=[runtime_secret],
    timeout=1800,
    min_containers=0,
    max_containers=4,
    scaledown_window=60,
)
def finalize_generation(request: dict[str, Any]) -> dict[str, Any]:
    """Run QC, thumbnails and optional object-storage publishing on CPU after GPU inference."""
    job_id = str(request["jobId"])
    staging_path = Path(str(request["stagingPath"]))
    profile = str(request.get("profile") or "LTX-2.5")
    expected_duration = float(request.get("expectedDuration") or 0) or None
    gpu_seconds = float(request.get("gpuSeconds") or 0)
    actual_cost = float(request.get("actualCost") or 0)
    try:
        if _job_cancelled(job_id):
            _set_job(job_id, status="CANCELLED", progress=0, message="Generation stopped by user", error=None, cancelled=True)
            return dict(jobs.get(job_id, {}))
        output_cache.reload()
        if not staging_path.exists():
            raise FileNotFoundError(f"Staged master not found: {staging_path}")
        _set_job(job_id, status="ANALYZING", progress=92, message="Running technical quality control")
        qc_report = _analyze_video(str(staging_path), expected_duration=expected_duration)

        if _job_cancelled(job_id):
            _set_job(job_id, status="CANCELLED", progress=0, message="Generation stopped by user", error=None, cancelled=True)
            return dict(jobs.get(job_id, {}))
        _set_job(job_id, status="UPLOADING", progress=96, message="Publishing master and thumbnail")
        directory = Path(OUTPUT_ROOT) / job_id
        directory.mkdir(parents=True, exist_ok=True)
        master_path = directory / "master.mp4"
        thumb_path = directory / "thumbnail.jpg"
        if staging_path != master_path:
            shutil.move(str(staging_path), str(master_path))
        _make_thumbnail(str(master_path), str(thumb_path))
        output_cache.commit()
        output_url = _upload_if_configured(str(master_path), f"generations/{job_id}/master.mp4", "video/mp4")
        thumbnail_url = _upload_if_configured(str(thumb_path), f"generations/{job_id}/thumbnail.jpg", "image/jpeg")

        if _job_cancelled(job_id):
            _set_job(job_id, status="CANCELLED", progress=0, message="Generation stopped by user", error=None, cancelled=True)
            return dict(jobs.get(job_id, {}))

        result = {
            "jobId": job_id,
            "status": "COMPLETED",
            "progress": 100,
            "message": f"Render complete | {profile} | QC {qc_report['technicalScore']}/100",
            "outputPath": str(master_path),
            "thumbnailPath": str(thumb_path),
            "outputUrl": output_url,
            "thumbnailUrl": thumbnail_url,
            "gpuSeconds": gpu_seconds,
            "actualCost": actual_cost,
            "qcReport": qc_report,
        }
        _set_job(job_id, **result)
        return result
    except Exception as exc:
        _set_job(job_id, status="FAILED", progress=0, message="Finalization failed", error=str(exc), gpuSeconds=gpu_seconds, actualCost=actual_cost)
        raise


@app.function(
    image=editor_image,
    volumes={OUTPUT_ROOT: output_cache},
    secrets=[runtime_secret],
    timeout=600,
    min_containers=0,
    max_containers=2,
    scaledown_window=30,
)
def cleanup_generation(job_id: str) -> dict[str, Any]:
    """Delete retained media for a terminal generation from Volume and optional object storage."""
    output_cache.reload()
    directory = Path(OUTPUT_ROOT) / job_id
    legacy = Path(OUTPUT_ROOT) / f"{job_id}.mp4"
    if directory.exists():
        shutil.rmtree(directory, ignore_errors=True)
    if legacy.exists():
        legacy.unlink(missing_ok=True)
    output_cache.commit()
    _delete_storage_prefix(f"generations/{job_id}/")
    return {"ok": True, "jobId": job_id}


@app.function(
    image=editor_image,
    volumes={OUTPUT_ROOT: output_cache},
    secrets=[runtime_secret],
    timeout=300,
    min_containers=0,
    max_containers=2,
    scaledown_window=30,
)
def cleanup_video_version(generation_id: str, version_id: str) -> dict[str, Any]:
    output_cache.reload()
    version_dir = Path(OUTPUT_ROOT) / generation_id / "versions"
    (version_dir / f"{version_id}.mp4").unlink(missing_ok=True)
    (version_dir / f"{version_id}.jpg").unlink(missing_ok=True)
    output_cache.commit()
    _delete_storage_prefix(f"generations/{generation_id}/versions/{version_id}")
    return {"ok": True, "generationId": generation_id, "versionId": version_id}


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
    base_path = snapshot_download(MODEL_REPO, cache_dir=CACHE_ROOT, token=token, ignore_patterns=["transformer_full/*"])
    snapshot_download(MODEL_REPO, cache_dir=CACHE_ROOT, token=token, allow_patterns=["transformer_full/*"])
    model_cache.commit()
    print(f"Cached LTX-2.5 Fast and Pro components at {base_path}")


@app.function(
    image=modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub>=0.35.0", "hf_transfer>=0.1.9"),
    volumes={CACHE_ROOT: model_cache},
    secrets=[runtime_secret],
    timeout=7200,
)
def prefetch_director():
    """Cache the local multimodal story Director / semantic reviewer."""
    from huggingface_hub import snapshot_download

    token = os.environ.get("HF_TOKEN")
    path = snapshot_download(DIRECTOR_MODEL_REPO, cache_dir=CACHE_ROOT, token=token)
    model_cache.commit()
    print(f"Cached Story Director at {path}")


DIRECTOR_SYSTEM_PROMPT = """You are Triven Cinema's story director. Convert the entire user source into a compact production plan for a video model. You must understand the beginning, middle, emotional turn, and ending; never plan only from the opening sentences. Preserve named characters and the story's meaning. Do not invent unrelated characters, modern props, crowds, or on-screen text. Keep recurring character design immutable. Separate what should be seen from narration/dialogue. For a short video, compress the source into the fewest strong visual beats that still cover the complete arc.

Return ONLY one JSON object with these keys:
{
  "title": string,
  "summary": string,
  "sourceSummary": string,
  "intent": string,
  "visualStyle": string,
  "cameraLanguage": string,
  "audioDirection": string,
  "narrationStyle": string,
  "characters": [{"name": string, "role": string, "appearance": string, "wardrobe": string, "voice": string, "immutableTraits": [string]}],
  "locations": [string],
  "mustHave": [string],
  "avoid": [string],
  "warnings": [string],
  "storyArc": {"setup": string, "development": string, "climax": string, "resolution": string},
  "scenes": [{
    "title": string,
    "storyBeat": string,
    "sourceExcerpt": string,
    "visual": string,
    "action": string,
    "camera": string,
    "audio": string,
    "dialogue": string,
    "narration": string,
    "transition": string,
    "charactersPresent": [string],
    "mustHave": [string],
    "negativePrompt": string
  }]
}

Scene rules: each scene represents one chronological beat; visual/action must describe only what appears on screen; narration is metadata and must never be rendered as text; dialogue should be short and only when essential; every recurring named character must use the exact same appearance and wardrobe description in all scenes; include no subtitles/captions/signage unless the user explicitly requests them. Use 5-8 scenes for a 45-60 second story unless the source truly needs fewer. """

REVIEW_SYSTEM_PROMPT = """You are Triven Cinema's visual continuity supervisor. Inspect a three-frame contact sheet from one generated scene against the requested scene requirements. When a previous-scene reference image is provided, compare recurring characters visually across the previous and current scene, while respecting characters that are intentionally absent from the current scene. Be strict about named characters, signature props, setting, scene action, continuity, unrelated subjects, and any accidental visible text/subtitles. Return ONLY JSON: {"score":0-100,"promptAdherence":0-100,"characterConsistency":0-100,"visibleText":boolean,"unrelatedSubjects":boolean,"issues":[string],"correction":string}. A score below 72 means the scene should be regenerated. The correction must be a concise positive visual instruction, not meta commentary."""


@app.cls(
    image=gpu_image,
    gpu="L4",
    volumes={CACHE_ROOT: model_cache},
    secrets=[runtime_secret],
    timeout=1200,
    min_containers=0,
    max_containers=1,
    scaledown_window=180,
)
class StorySupervisor:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoProcessor, Qwen3VLForConditionalGeneration

        token = os.environ.get("HF_TOKEN")
        self.processor = AutoProcessor.from_pretrained(DIRECTOR_MODEL_REPO, cache_dir=CACHE_ROOT, token=token)
        self.model = Qwen3VLForConditionalGeneration.from_pretrained(
            DIRECTOR_MODEL_REPO,
            cache_dir=CACHE_ROOT,
            token=token,
            torch_dtype=torch.bfloat16,
            device_map="auto",
        )
        self.model.eval()

    def _generate(self, messages: list[dict[str, Any]], max_new_tokens: int) -> str:
        inputs = self.processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        ).to(self.model.device)
        outputs = self.model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            repetition_penalty=1.03,
        )
        trimmed = [out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, outputs)]
        return self.processor.batch_decode(trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0]

    @modal.method()
    def plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        duration = int(payload.get("durationSeconds", 45))
        video_type = str(payload.get("videoType", "story"))
        aspect = str(payload.get("aspectRatio", "16:9"))
        source = str(payload.get("prompt", ""))[:12000]
        user_text = (
            f"Create a {duration}-second {video_type} video in {aspect}. Read the complete source before planning. "
            "For story/cartoon/devotional content, preserve recurring character identity and cover the ending, not only the opening. "
            "The generated image must contain no captions, subtitles, prompt text, or random lettering.\n\nSOURCE:\n" + source
        )
        raw = self._generate([
            {"role": "system", "content": [{"type": "text", "text": DIRECTOR_SYSTEM_PROMPT}]},
            {"role": "user", "content": [{"type": "text", "text": user_text}]},
        ], max_new_tokens=4200)
        result = _extract_json_object(raw)
        result["directorModel"] = DIRECTOR_MODEL_REPO
        return result

    @modal.method()
    def review_scene(self, image_bytes: bytes, requirements: dict[str, Any], previous_image_bytes: bytes | None = None) -> dict[str, Any]:
        from PIL import Image

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        requirement_text = json.dumps(requirements, ensure_ascii=False)[:12000]
        content: list[dict[str, Any]] = []
        if previous_image_bytes:
            previous = Image.open(io.BytesIO(previous_image_bytes)).convert("RGB")
            content.extend([
                {"type": "text", "text": "PREVIOUS SCENE REFERENCE FRAME (continuity reference):"},
                {"type": "image", "image": previous},
            ])
        content.extend([
            {"type": "text", "text": "CURRENT SCENE THREE-FRAME CONTACT SHEET:"},
            {"type": "image", "image": image},
            {"type": "text", "text": f"SCENE REQUIREMENTS:\n{requirement_text}"},
        ])
        raw = self._generate([
            {"role": "system", "content": [{"type": "text", "text": REVIEW_SYSTEM_PROMPT}]},
            {"role": "user", "content": content},
        ], max_new_tokens=700)
        review = _extract_json_object(raw)
        for key in ("score", "promptAdherence", "characterConsistency"):
            try:
                review[key] = max(0, min(100, int(review.get(key, 0))))
            except (TypeError, ValueError):
                review[key] = 0
        review["visibleText"] = bool(review.get("visibleText", False))
        review["unrelatedSubjects"] = bool(review.get("unrelatedSubjects", False))
        review["issues"] = [str(item)[:300] for item in review.get("issues", []) if str(item).strip()][:12]
        review["correction"] = str(review.get("correction", ""))[:1200]
        return review


@app.cls(
    image=gpu_image,
    gpu="B200",
    volumes={CACHE_ROOT: model_cache, OUTPUT_ROOT: output_cache},
    secrets=[runtime_secret],
    timeout=7200,
    min_containers=0,
    max_containers=1,
    scaledown_window=120,
)
class LTXWorker:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import FlowMatchEulerDiscreteScheduler, LTX2ImageToVideoPipeline, LTX2LatentUpsamplePipeline, LTX2Pipeline
        from diffusers.pipelines.ltx2.latent_upsampler import LTX2LatentUpsamplerModel

        token = os.environ.get("HF_TOKEN")
        self.pipe = LTX2Pipeline.from_pretrained(MODEL_REPO, torch_dtype=torch.bfloat16, cache_dir=CACHE_ROOT, token=token)
        self.pipe.to("cuda")
        self.pipe.vae.enable_tiling()
        self.i2v_pipe = LTX2ImageToVideoPipeline.from_pipe(self.pipe)
        self.i2v_pipe.to("cuda")
        self.i2v_pipe.vae.enable_tiling()
        self.fast_transformer = self.pipe.transformer
        self.fast_scheduler = self.pipe.scheduler
        self.pro_transformer = None
        self.pro_scheduler = None
        self.scheduler_cls = FlowMatchEulerDiscreteScheduler
        self.token = token
        self.upsampler_model = LTX2LatentUpsamplerModel.from_pretrained(
            MODEL_REPO, subfolder="latent_upsampler", torch_dtype=torch.bfloat16, cache_dir=CACHE_ROOT, token=token,
        ).to("cuda")
        self.upsample_pipe = LTX2LatentUpsamplePipeline(vae=self.pipe.vae, latent_upsampler=self.upsampler_model)

    def _ensure_pro(self) -> None:
        if self.pro_transformer is not None:
            return
        import torch
        from diffusers import LTX2VideoTransformer3DModel
        self.pro_transformer = LTX2VideoTransformer3DModel.from_pretrained(
            MODEL_REPO, subfolder="transformer_full", torch_dtype=torch.bfloat16, cache_dir=CACHE_ROOT, token=self.token,
        ).to("cuda")
        self.pro_scheduler = self.scheduler_cls.from_config(self.fast_scheduler.config, use_dynamic_shifting=True, shift_terminal=0.1)

    def _activate_mode(self, render_mode: str) -> None:
        if render_mode == "pro":
            self._ensure_pro()
            self.pipe.transformer = self.pro_transformer
            self.pipe.scheduler = self.pro_scheduler
            self.i2v_pipe.transformer = self.pro_transformer
            self.i2v_pipe.scheduler = self.pro_scheduler
        else:
            self.pipe.transformer = self.fast_transformer
            self.pipe.scheduler = self.fast_scheduler
            self.i2v_pipe.transformer = self.fast_transformer
            self.i2v_pipe.scheduler = self.fast_scheduler

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

    def _render_clip(self, prompt: str, aspect: str, render_mode: str, resolution: str, fps: int, duration: int, audio_quality: str, seed: int, out_dir: str, index: int, reference_image: str | None = None, negative_prompt_extra: str | None = None) -> str:
        import torch
        from diffusers.pipelines.ltx2.utils import DEFAULT_NEGATIVE_PROMPT, STAGE_2_DISTILLED_SIGMA_VALUES
        from diffusers.utils import encode_video, load_image

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
        active_pipe = self.i2v_pipe if reference_image else self.pipe
        conditioning = {"image": load_image(reference_image)} if reference_image else {}
        combined_negative = f"{DEFAULT_NEGATIVE_PROMPT}, {_story_negative_prompt(negative_prompt_extra)}"
        if upscale_count == 0:
            video, audio = active_pipe(
                **conditioning,
                prompt=prompt,
                negative_prompt=combined_negative,
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
            video_latent, audio_latent = active_pipe(
                **conditioning,
                prompt=prompt,
                negative_prompt=combined_negative,
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
                upscaled_video_latent = self.upsample_pipe(latents=upscaled_video_latent, output_type="latent", return_dict=False)[0]
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
            if _job_cancelled(job_id):
                _set_job(job_id, status="CANCELLED", progress=0, message="Generation stopped by user", error=None, cancelled=True)
                return dict(jobs.get(job_id, {}))

            render_mode = _normalize_render_mode(str(request.get("renderMode", "fast")))
            resolution = _normalize_resolution(str(request.get("resolution", "1080p")))
            fps = _normalize_fps(request.get("fps", 24))
            audio_quality = _normalize_audio_quality(str(request.get("audioQuality", "standard")), bool(request.get("nativeAudio", True)))
            profile = _profile_label(render_mode, resolution, fps, audio_quality)
            clip_limit = _max_clip_seconds(render_mode, resolution, fps)

            _set_job(job_id, status="GENERATING", progress=8, message=f"B200 started | {profile} | loading LTX-2.5")
            mode = request.get("mode", "DIRECT")
            clips: list[str] = []

            if mode == "SCENES":
                scenes = request.get("scenes") or []
                total = max(1, len(scenes))
                continuity_mode = str(request.get("continuityMode", "balanced")).lower()
                story_accuracy = str(request.get("storyAccuracy", "standard")).lower()
                video_type = str(request.get("videoType", "cinematic")).lower()
                semantic_review_enabled = story_accuracy == "high" and video_type in {"story", "cartoon", "devotional"}
                previous_frame: str | None = None
                scene_reviews: list[dict[str, Any]] = []
                for i, scene in enumerate(scenes):
                    if _job_cancelled(job_id):
                        raise RuntimeError("Generation stopped by user")
                    scene_duration = int(scene.get("duration", 5))
                    if scene_duration > clip_limit:
                        raise ValueError(f"This render profile supports up to {clip_limit}s per scene; scene {i + 1} is {scene_duration}s.")
                    memory = scene.get("memory") or {}
                    bridge_requested = bool(memory.get("bridgeFromPrevious", continuity_mode == "strict"))
                    use_bridge = bool(previous_frame) and continuity_mode != "creative" and bridge_requested
                    progress = 12 + int((i / total) * 62)
                    bridge_label = " | previous-frame memory" if use_bridge else ""
                    _set_job(job_id, status="GENERATING", progress=progress, message=f"Rendering scene {i + 1} of {total} | {profile}{bridge_label}", sceneIndex=i + 1, sceneCount=total)
                    clip = self._render_clip(
                        prompt=scene["prompt"], aspect=request["aspectRatio"], render_mode=render_mode, resolution=resolution,
                        fps=fps, duration=scene_duration, audio_quality=audio_quality, seed=int(request.get("seed", 42)), out_dir=temp_dir, index=i,
                        reference_image=previous_frame if use_bridge else None,
                        negative_prompt_extra=str(scene.get("negativePrompt") or ""),
                    )

                    if semantic_review_enabled and not _job_cancelled(job_id):
                        try:
                            sheet_path = _contact_sheet(clip, str(Path(temp_dir) / f"review-{i}.jpg"), scene_duration)
                            requirements = {
                                "scene": i + 1,
                                "title": scene.get("title"),
                                "storyBeat": scene.get("storyBeat"),
                                "sourceExcerpt": scene.get("sourceExcerpt"),
                                "visual": scene.get("visual"),
                                "action": scene.get("action"),
                                "charactersPresent": scene.get("charactersPresent") or [],
                                "mustHave": scene.get("mustHave") or [],
                                "narrationIntent": scene.get("narration"),
                                "characterMemory": memory.get("characterLock"),
                                "worldMemory": memory.get("worldLock"),
                                "previousScene": memory.get("previousSceneSummary"),
                            }
                            _set_job(job_id, status="GENERATING", progress=min(78, progress + 4), message=f"Checking scene {i + 1} story accuracy and character continuity")
                            previous_review_frame = Path(previous_frame).read_bytes() if previous_frame and Path(previous_frame).exists() else None
                            review = StorySupervisor().review_scene.remote(Path(sheet_path).read_bytes(), requirements, previous_review_frame)
                            review["sceneIndex"] = i + 1
                            review["retried"] = False
                            needs_retry = (
                                int(review.get("score", 0)) < 72
                                or int(review.get("promptAdherence", 0)) < 68
                                or int(review.get("characterConsistency", 0)) < 65
                                or bool(review.get("visibleText"))
                                or bool(review.get("unrelatedSubjects"))
                            )
                            if needs_retry:
                                correction = str(review.get("correction") or "Center the required characters and requested action clearly, preserving their established appearance and the intended setting.")
                                retry_prompt = f"{scene['prompt']} {correction}"[:11800]
                                _set_job(job_id, status="GENERATING", progress=min(79, progress + 6), message=f"Scene {i + 1} missed the brief; regenerating once with Director correction")
                                clip = self._render_clip(
                                    prompt=retry_prompt, aspect=request["aspectRatio"], render_mode=render_mode, resolution=resolution,
                                    fps=fps, duration=scene_duration, audio_quality=audio_quality, seed=int(request.get("seed", 42)) + 5000, out_dir=temp_dir, index=i,
                                    reference_image=previous_frame if use_bridge else None,
                                    negative_prompt_extra=str(scene.get("negativePrompt") or ""),
                                )
                                review["retried"] = True
                                try:
                                    retry_sheet = _contact_sheet(clip, str(Path(temp_dir) / f"review-retry-{i}.jpg"), scene_duration)
                                    post_review = StorySupervisor().review_scene.remote(Path(retry_sheet).read_bytes(), requirements, previous_review_frame)
                                    review["postRetry"] = post_review
                                    review["score"] = int(post_review.get("score", review.get("score", 0)))
                                    review["promptAdherence"] = int(post_review.get("promptAdherence", review.get("promptAdherence", 0)))
                                    review["characterConsistency"] = int(post_review.get("characterConsistency", review.get("characterConsistency", 0)))
                                    review["visibleText"] = bool(post_review.get("visibleText", review.get("visibleText", False)))
                                    review["unrelatedSubjects"] = bool(post_review.get("unrelatedSubjects", review.get("unrelatedSubjects", False)))
                                    review["issues"] = post_review.get("issues", review.get("issues", []))
                                except Exception as recheck_exc:
                                    review["postRetryError"] = str(recheck_exc)
                            scene_reviews.append(review)
                            _set_job(job_id, sceneReviews=scene_reviews)
                        except Exception as review_exc:
                            scene_reviews.append({"sceneIndex": i + 1, "score": 0, "issues": [f"Semantic review unavailable: {review_exc}"], "retried": False})
                            _set_job(job_id, sceneReviews=scene_reviews)

                    clips.append(clip)
                    if continuity_mode != "creative":
                        previous_frame = _extract_last_frame(clip, str(Path(temp_dir) / f"memory-frame-{i}.png"))
            else:
                direct_duration = int(request.get("durationSeconds", 5))
                if direct_duration > clip_limit:
                    raise ValueError(f"{profile} supports up to {clip_limit}s per direct clip. Use scene mode for longer videos.")
                _set_job(job_id, status="GENERATING", progress=20, message=f"Rendering video | {profile}")
                clips.append(self._render_clip(
                    prompt=request["prompt"], aspect=request["aspectRatio"], render_mode=render_mode, resolution=resolution,
                    fps=fps, duration=direct_duration, audio_quality=audio_quality, seed=int(request.get("seed", 42)), out_dir=temp_dir, index=0,
                    negative_prompt_extra=_story_negative_prompt() if str(request.get("videoType", "")) in {"story", "cartoon", "devotional"} else None,
                ))

            if _job_cancelled(job_id):
                raise RuntimeError("Generation stopped by user")

            final_path = str(Path(temp_dir) / "final.mp4")
            _set_job(job_id, status="STITCHING", progress=82, message="Composing final MP4")
            if len(clips) == 1:
                shutil.copy2(clips[0], final_path)
            else:
                _concat(clips, final_path)

            # End expensive B200 work here. Copy the master to the shared Volume, then hand
            # technical QC, thumbnailing and object-storage publishing to a CPU worker.
            stage_dir = Path(OUTPUT_ROOT) / job_id
            stage_dir.mkdir(parents=True, exist_ok=True)
            staging_path = stage_dir / "staging.mp4"
            shutil.copy2(final_path, staging_path)
            output_cache.commit()
            gpu_seconds = time.time() - started
            actual_cost = gpu_seconds * B200_PRICE_PER_SECOND
            _set_job(job_id, status="ANALYZING", progress=88, message="GPU render complete; handing off to CPU quality control", gpuSeconds=gpu_seconds, actualCost=actual_cost)
            finalize_call = finalize_generation.spawn({
                "jobId": job_id,
                "stagingPath": str(staging_path),
                "profile": profile,
                "expectedDuration": float(request.get("durationSeconds") or 0),
                "gpuSeconds": gpu_seconds,
                "actualCost": actual_cost,
            })
            _set_job(job_id, finalizeCallId=finalize_call.object_id)
            return dict(jobs.get(job_id, {}))
        except Exception as exc:
            gpu_seconds = time.time() - started
            if _job_cancelled(job_id):
                _set_job(job_id, status="CANCELLED", progress=0, message="Generation stopped by user", error=None, gpuSeconds=gpu_seconds, actualCost=gpu_seconds * B200_PRICE_PER_SECOND, cancelled=True)
                return dict(jobs.get(job_id, {}))
            _set_job(job_id, status="FAILED", progress=0, message="Render failed", error=str(exc), gpuSeconds=gpu_seconds, actualCost=gpu_seconds * B200_PRICE_PER_SECOND)
            raise
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


def _atempo_chain(speed: float) -> str:
    factors: list[float] = []
    remaining = speed
    while remaining > 2.0:
        factors.append(2.0)
        remaining /= 2.0
    while remaining < 0.5:
        factors.append(0.5)
        remaining /= 0.5
    factors.append(remaining)
    return ",".join(f"atempo={factor:.6f}" for factor in factors)


def _preset_adjustments(preset: str) -> tuple[float, float, float]:
    if preset == "cinematic":
        return (-0.015, 1.08, 0.92)
    if preset == "vivid":
        return (0.01, 1.07, 1.18)
    if preset == "social":
        return (0.015, 1.10, 1.22)
    if preset == "clean":
        return (0.0, 1.03, 1.0)
    return (0.0, 1.0, 1.0)


def _crop_filter(crop: str) -> str | None:
    if crop == "16:9":
        return "crop=w='min(iw,ih*16/9)':h='min(ih,iw*9/16)'"
    if crop == "9:16":
        return "crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)'"
    if crop == "1:1":
        return "crop=w='min(iw,ih)':h='min(iw,ih)'"
    return None


@app.function(
    image=editor_image,
    volumes={OUTPUT_ROOT: output_cache},
    secrets=[runtime_secret],
    timeout=1800,
    min_containers=0,
    max_containers=4,
    scaledown_window=60,
)
def edit_video(request: dict[str, Any]) -> dict[str, Any]:
    version_id = str(request["versionId"])
    generation_id = str(request["generationId"])
    operations = dict(request.get("operations") or {})
    temp_dir = tempfile.mkdtemp(prefix=f"triven-edit-{version_id}-")
    try:
        _set_edit(version_id, generationId=generation_id, status="PROCESSING", progress=8, message="Preparing source video")
        local_master = Path(OUTPUT_ROOT) / generation_id / "master.mp4"
        if local_master.exists():
            source = str(local_master)
        else:
            source_url = str(request.get("sourceUrl") or "")
            if not source_url.startswith(("https://", "http://")):
                raise ValueError("Source video is unavailable for editing")
            source = str(Path(temp_dir) / "source.mp4")
            urllib.request.urlretrieve(source_url, source)

        probe = _probe(source)
        streams = probe.get("streams", [])
        has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
        source_duration = float(probe.get("format", {}).get("duration") or 0)
        start = max(0.0, float(operations.get("trimStart", 0) or 0))
        raw_end = operations.get("trimEnd")
        end = source_duration if raw_end in (None, "") else min(source_duration, float(raw_end))
        if end <= start:
            raise ValueError("Trim end must be after trim start")
        speed = max(0.25, min(4.0, float(operations.get("speed", 1) or 1)))
        clipped_duration = max(0.05, end - start)
        output_duration = clipped_duration / speed

        preset_brightness, preset_contrast, preset_saturation = _preset_adjustments(str(operations.get("preset", "custom")))
        brightness = max(-0.5, min(0.5, float(operations.get("brightness", 0) or 0) + preset_brightness))
        contrast = max(0.5, min(2.0, float(operations.get("contrast", 1) or 1) * preset_contrast))
        saturation = max(0.0, min(3.0, float(operations.get("saturation", 1) or 1) * preset_saturation))
        sharpen = max(0.0, min(2.0, float(operations.get("sharpen", 0) or 0)))
        blur = max(0.0, min(12.0, float(operations.get("blur", 0) or 0)))
        vignette = bool(operations.get("vignette", False))
        normalize_audio = bool(operations.get("normalizeAudio", False))
        fade_in = max(0.0, min(float(operations.get("fadeIn", 0) or 0), output_duration / 2))
        fade_out = max(0.0, min(float(operations.get("fadeOut", 0) or 0), output_duration / 2))

        video_filters: list[str] = []
        crop = _crop_filter(str(operations.get("crop", "original")))
        if crop:
            video_filters.append(crop)
        rotate = int(operations.get("rotate", 0) or 0)
        if rotate == 90:
            video_filters.append("transpose=1")
        elif rotate == 270:
            video_filters.append("transpose=2")
        elif rotate == 180:
            video_filters.extend(["hflip", "vflip"])
        if bool(operations.get("mirror", False)):
            video_filters.append("hflip")
        if speed != 1.0:
            video_filters.append(f"setpts=PTS/{speed:.6f}")
        if brightness != 0.0 or contrast != 1.0 or saturation != 1.0:
            video_filters.append(f"eq=brightness={brightness:.4f}:contrast={contrast:.4f}:saturation={saturation:.4f}")
        if sharpen > 0:
            amount = min(2.0, sharpen)
            video_filters.append(f"unsharp=5:5:{amount:.4f}:5:5:0")
        if blur > 0:
            radius = max(1, min(12, int(round(blur))))
            video_filters.append(f"boxblur=luma_radius={radius}:luma_power=1")
        if vignette:
            video_filters.append("vignette=PI/5")
        if fade_in > 0:
            video_filters.append(f"fade=t=in:st=0:d={fade_in:.3f}")
        if fade_out > 0:
            video_filters.append(f"fade=t=out:st={max(0.0, output_duration - fade_out):.3f}:d={fade_out:.3f}")
        video_filters.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")

        audio_filters: list[str] = []
        mute = bool(operations.get("mute", False))
        if has_audio and not mute:
            if speed != 1.0:
                audio_filters.append(_atempo_chain(speed))
            volume = max(0.0, min(2.0, float(operations.get("volume", 1) or 1)))
            if volume != 1.0:
                audio_filters.append(f"volume={volume:.4f}")
            if normalize_audio:
                audio_filters.append("loudnorm=I=-16:LRA=11:TP=-1.5")
            if fade_in > 0:
                audio_filters.append(f"afade=t=in:st=0:d={fade_in:.3f}")
            if fade_out > 0:
                audio_filters.append(f"afade=t=out:st={max(0.0, output_duration - fade_out):.3f}:d={fade_out:.3f}")

        _set_edit(version_id, generationId=generation_id, status="PROCESSING", progress=38, message="Rendering non-destructive edit")
        out_dir = Path(OUTPUT_ROOT) / generation_id / "versions"
        out_dir.mkdir(parents=True, exist_ok=True)
        output_path = out_dir / f"{version_id}.mp4"
        thumb_path = out_dir / f"{version_id}.jpg"

        command = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{clipped_duration:.3f}", "-i", source]
        if video_filters:
            command += ["-vf", ",".join(video_filters)]
        command += ["-c:v", "libx264", "-preset", "medium", "-crf", "16"]
        if mute or not has_audio:
            command += ["-an"]
        else:
            if audio_filters:
                command += ["-af", ",".join(audio_filters)]
            command += ["-c:a", "aac", "-b:a", "256k"]
        command += ["-movflags", "+faststart", str(output_path)]
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        _set_edit(version_id, generationId=generation_id, status="PROCESSING", progress=78, message="Running technical QC")
        qc_report = _analyze_video(str(output_path), expected_duration=output_duration)
        _make_thumbnail(str(output_path), str(thumb_path))
        output_cache.commit()
        output_url = _upload_if_configured(str(output_path), f"generations/{generation_id}/versions/{version_id}.mp4", "video/mp4")
        thumbnail_url = _upload_if_configured(str(thumb_path), f"generations/{generation_id}/versions/{version_id}.jpg", "image/jpeg")
        result = {
            "versionId": version_id,
            "generationId": generation_id,
            "status": "COMPLETED",
            "progress": 100,
            "message": f"Edit complete | QC {qc_report['technicalScore']}/100",
            "outputPath": str(output_path),
            "thumbnailPath": str(thumb_path),
            "outputUrl": output_url,
            "thumbnailUrl": thumbnail_url,
            "qcReport": qc_report,
        }
        _set_edit(version_id, **result)
        return result
    except Exception as exc:
        _set_edit(version_id, generationId=generation_id, status="FAILED", progress=0, message="Edit failed", error=str(exc))
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
        return {
            "ok": True,
            "model": "LTX-2.5",
            "gpu": "B200",
            "modes": ["fast", "pro"],
            "resolutions": ["720p", "1080p", "1440p", "4k"],
            "fps": [24, 25, 30, 48, 50],
            "features": ["cancel", "media-cleanup", "technical-qc", "signed-volume-media", "thumbnails", "non-destructive-editing", "optional-s3-storage", "ai-story-director", "scene-semantic-review", "previous-frame-continuity"],
            "directorModel": DIRECTOR_MODEL_REPO,
        }

    @service.post("/director/plan")
    def director_plan(payload: dict[str, Any], x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        prompt = str(payload.get("prompt", "")).strip()
        if len(prompt) < 5:
            raise HTTPException(status_code=400, detail="prompt is required")
        return StorySupervisor().plan.remote(payload)

    @service.post("/submit")
    def submit(payload: dict[str, Any], x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        job_id = str(payload.get("jobId", "")).strip()
        if not job_id:
            raise HTTPException(status_code=400, detail="jobId is required")
        _set_job(job_id, status="QUEUED", progress=3, message="Queued for B200", cancelled=False, cancelRequested=False)
        call = LTXWorker().generate.spawn(payload)
        _set_job(job_id, callId=call.object_id)
        latest = dict(jobs.get(job_id, {}))
        if latest.get("cancelRequested"):
            try:
                modal.FunctionCall.from_id(str(call.object_id)).cancel(terminate_containers=False)
            finally:
                _set_job(job_id, status="CANCELLED", progress=0, message="Generation stopped by user", cancelled=True)
        return {"jobId": job_id, "callId": call.object_id}

    @service.post("/cancel/{job_id}")
    def cancel(job_id: str, x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        state = jobs.get(job_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Job not found")
        state = dict(state)
        if state.get("status") in {"COMPLETED", "FAILED", "CANCELLED"}:
            return state

        _set_job(job_id, status="CANCEL_REQUESTED", message="Stopping generation", cancelRequested=True)
        latest = dict(jobs.get(job_id, {}))
        call_id = latest.get("finalizeCallId") or latest.get("callId")
        if not call_id:
            return latest
        try:
            modal.FunctionCall.from_id(str(call_id)).cancel(terminate_containers=False)
        except Exception as exc:
            # Keep cancelRequested=true so the worker exits at its next safe checkpoint.
            _set_job(job_id, message=f"Stop requested; waiting for worker checkpoint ({exc})")
            return dict(jobs.get(job_id, {}))

        _set_job(job_id, status="CANCELLED", progress=0, message="Generation stopped by user", error=None, cancelled=True)
        return dict(jobs.get(job_id, {}))

    @service.delete("/delete/{job_id}")
    def delete_generation(job_id: str, x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        state = jobs.get(job_id)
        if state is not None and dict(state).get("status") not in {"COMPLETED", "FAILED", "CANCELLED"}:
            raise HTTPException(status_code=409, detail="Active generation must be stopped before deletion")
        result = cleanup_generation.remote(job_id)
        return result

    @service.get("/status/{job_id}")
    def status(job_id: str, request: Request, x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        state = jobs.get(job_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Job not found")
        state = dict(state)
        if state.get("status") == "COMPLETED":
            base = str(request.base_url).rstrip("/")
            if not state.get("outputUrl") and state.get("outputPath"):
                state["outputUrl"] = _signed_media_url(base, f"/video/{job_id}", "video", job_id)
            if not state.get("thumbnailUrl") and state.get("thumbnailPath"):
                state["thumbnailUrl"] = _signed_media_url(base, f"/thumbnail/{job_id}", "thumbnail", job_id)
        return state

    @service.post("/edit/submit")
    def submit_edit(payload: dict[str, Any], x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        version_id = str(payload.get("versionId", "")).strip()
        generation_id = str(payload.get("generationId", "")).strip()
        if not version_id or not generation_id:
            raise HTTPException(status_code=400, detail="versionId and generationId are required")
        _set_edit(version_id, generationId=generation_id, status="QUEUED", progress=3, message="Queued for CPU editor")
        call = edit_video.spawn(payload)
        _set_edit(version_id, callId=call.object_id)
        return {"versionId": version_id, "callId": call.object_id}

    @service.delete("/edit/delete/{generation_id}/{version_id}")
    def delete_edit(generation_id: str, version_id: str, x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        state = edit_jobs.get(version_id)
        if state is not None and dict(state).get("status") in {"QUEUED", "PROCESSING"}:
            raise HTTPException(status_code=409, detail="Active edit cannot be deleted")
        return cleanup_video_version.remote(generation_id, version_id)

    @service.get("/edit/status/{version_id}")
    def edit_status(version_id: str, request: Request, x_triven_secret: str | None = Header(default=None)):
        _auth(x_triven_secret)
        state = edit_jobs.get(version_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Edit job not found")
        state = dict(state)
        if state.get("status") == "COMPLETED":
            base = str(request.base_url).rstrip("/")
            generation_id = state.get("generationId")
            if not state.get("outputUrl") and state.get("outputPath"):
                state["outputUrl"] = _signed_media_url(base, f"/video-version/{generation_id}/{version_id}", "video-version", str(generation_id), version_id)
            if not state.get("thumbnailUrl") and state.get("thumbnailPath"):
                state["thumbnailUrl"] = _signed_media_url(base, f"/thumbnail-version/{generation_id}/{version_id}", "thumbnail-version", str(generation_id), version_id)
        return state

    @service.get("/video/{job_id}")
    def video(job_id: str, token: str | None = None):
        _require_media_token(token, "video", job_id)
        output_cache.reload()
        path = Path(OUTPUT_ROOT) / job_id / "master.mp4"
        if not path.exists():
            legacy = Path(OUTPUT_ROOT) / f"{job_id}.mp4"
            path = legacy if legacy.exists() else path
        if not path.exists():
            raise HTTPException(status_code=404, detail="Video not found")
        return FileResponse(path, media_type="video/mp4", filename=f"triven-cinema-{job_id}.mp4", headers={"Cache-Control": "private, max-age=3600", "Access-Control-Allow-Origin": "*"})

    @service.get("/thumbnail/{job_id}")
    def thumbnail(job_id: str, token: str | None = None):
        _require_media_token(token, "thumbnail", job_id)
        output_cache.reload()
        path = Path(OUTPUT_ROOT) / job_id / "thumbnail.jpg"
        if not path.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600", "Access-Control-Allow-Origin": "*"})

    @service.get("/video-version/{generation_id}/{version_id}")
    def video_version(generation_id: str, version_id: str, token: str | None = None):
        _require_media_token(token, "video-version", generation_id, version_id)
        output_cache.reload()
        path = Path(OUTPUT_ROOT) / generation_id / "versions" / f"{version_id}.mp4"
        if not path.exists():
            raise HTTPException(status_code=404, detail="Edited video not found")
        return FileResponse(path, media_type="video/mp4", filename=f"triven-cinema-{version_id}.mp4", headers={"Cache-Control": "private, max-age=3600", "Access-Control-Allow-Origin": "*"})

    @service.get("/thumbnail-version/{generation_id}/{version_id}")
    def thumbnail_version(generation_id: str, version_id: str, token: str | None = None):
        _require_media_token(token, "thumbnail-version", generation_id, version_id)
        output_cache.reload()
        path = Path(OUTPUT_ROOT) / generation_id / "versions" / f"{version_id}.jpg"
        if not path.exists():
            raise HTTPException(status_code=404, detail="Edited thumbnail not found")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600", "Access-Control-Allow-Origin": "*"})

    return service
