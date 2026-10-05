"use client";

import { useCallback, useEffect, useState } from "react";
import type { VideoEditOperations, VideoVersionState } from "@/lib/types";

const DEFAULTS: VideoEditOperations = {
  preset: "custom",
  trimStart: 0,
  trimEnd: null,
  speed: 1,
  volume: 1,
  mute: false,
  fadeIn: 0,
  fadeOut: 0,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  sharpen: 0,
  blur: 0,
  vignette: false,
  normalizeAudio: false,
  crop: "original",
  rotate: 0,
  mirror: false,
};

function replaceVersion(items: VideoVersionState[], next: VideoVersionState) {
  return [next, ...items.filter((item) => item.id !== next.id)];
}

export function VideoEditor({
  generationId,
  originalUrl,
  durationSeconds,
  initialVersions = [],
  onPreviewChange,
}: {
  generationId: string;
  originalUrl: string;
  durationSeconds: number;
  initialVersions?: VideoVersionState[];
  onPreviewChange: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [operations, setOperations] = useState<VideoEditOperations>(DEFAULTS);
  const [versions, setVersions] = useState<VideoVersionState[]>(initialVersions);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refreshVersions = useCallback(async () => {
    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(generationId)}/edits`, { cache: "no-store" });
      if (!response.ok) return;
      const rows: VideoVersionState[] = await response.json();
      setVersions(rows);
    } catch { /* keep current list */ }
  }, [generationId]);

  function toggleEditor() {
    if (!open) void refreshVersions();
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!processingId) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/generations/${encodeURIComponent(generationId)}/edits/${encodeURIComponent(processingId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const version: VideoVersionState = await response.json();
        if (cancelled) return;
        setVersions((items) => replaceVersion(items, version));
        if (version.status === "COMPLETED") {
          setProcessingId(null);
          if (version.outputUrl) onPreviewChange(version.outputUrl);
        } else if (version.status === "FAILED") {
          setProcessingId(null);
          setError(version.error || "The edit could not be completed.");
        }
      } catch { /* retry on next interval */ }
    }, 1800);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [generationId, onPreviewChange, processingId]);

  async function deleteVersion(versionId: string) {
    if (processingId === versionId) return;
    setError("");
    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(generationId)}/edits/${encodeURIComponent(versionId)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Could not delete edit version");
      setVersions((items) => items.filter((item) => item.id !== versionId));
      onPreviewChange(originalUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete edit version");
    }
  }

  async function applyEdit() {
    if (processingId) return;
    setError("");
    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(generationId)}/edits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: `${operations.preset === "custom" ? "Custom" : operations.preset} edit`, operations }),
      });
      const version: VideoVersionState & { error?: string } = await response.json();
      if (!response.ok || !version.id) throw new Error(version.error || "Could not start edit");
      setVersions((items) => replaceVersion(items, version));
      if (version.status === "COMPLETED" && version.outputUrl) onPreviewChange(version.outputUrl);
      else setProcessingId(version.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start edit");
    }
  }

  const set = <K extends keyof VideoEditOperations,>(key: K, value: VideoEditOperations[K]) => setOperations((current) => ({ ...current, [key]: value }));

  return <div className={`videoEditor ${open ? "open" : ""}`}>
    <button className="editorToggle" type="button" onClick={toggleEditor}>
      <span>Video editor</span><small>Trim · speed · color · audio · crop · finishing</small>
    </button>
    {open && <div className="editorBody">
      <div className="editorToolbar">
        <label><span>Preset</span><select value={operations.preset} onChange={(event) => set("preset", event.target.value as VideoEditOperations["preset"])}>
          <option value="custom">Custom</option><option value="cinematic">Cinematic</option><option value="vivid">Vivid</option><option value="social">Social punch</option><option value="clean">Clean</option>
        </select></label>
        <label><span>Crop</span><select value={operations.crop} onChange={(event) => set("crop", event.target.value as VideoEditOperations["crop"])}>
          <option value="original">Original</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
        </select></label>
        <label><span>Rotate</span><select value={operations.rotate} onChange={(event) => set("rotate", Number(event.target.value) as VideoEditOperations["rotate"])}>
          <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
        </select></label>
      </div>

      <div className="editorGrid">
        <label><span>Trim start</span><input type="number" min={0} max={durationSeconds} step="0.1" value={operations.trimStart} onChange={(event) => set("trimStart", Number(event.target.value))} /><small>seconds</small></label>
        <label><span>Trim end</span><input type="number" min={0} max={durationSeconds} step="0.1" placeholder={`${durationSeconds}`} value={operations.trimEnd ?? ""} onChange={(event) => set("trimEnd", event.target.value === "" ? null : Number(event.target.value))} /><small>seconds</small></label>
        <label><span>Speed</span><input type="range" min="0.25" max="4" step="0.05" value={operations.speed} onChange={(event) => set("speed", Number(event.target.value))} /><strong>{operations.speed.toFixed(2)}×</strong></label>
        <label><span>Volume</span><input type="range" min="0" max="2" step="0.05" value={operations.volume} disabled={operations.mute} onChange={(event) => set("volume", Number(event.target.value))} /><strong>{operations.mute ? "Muted" : `${Math.round(operations.volume * 100)}%`}</strong></label>
        <label><span>Fade in</span><input type="range" min="0" max="5" step="0.1" value={operations.fadeIn} onChange={(event) => set("fadeIn", Number(event.target.value))} /><strong>{operations.fadeIn.toFixed(1)}s</strong></label>
        <label><span>Fade out</span><input type="range" min="0" max="5" step="0.1" value={operations.fadeOut} onChange={(event) => set("fadeOut", Number(event.target.value))} /><strong>{operations.fadeOut.toFixed(1)}s</strong></label>
        <label><span>Brightness</span><input type="range" min="-0.3" max="0.3" step="0.01" value={operations.brightness} onChange={(event) => set("brightness", Number(event.target.value))} /><strong>{operations.brightness.toFixed(2)}</strong></label>
        <label><span>Contrast</span><input type="range" min="0.6" max="1.6" step="0.02" value={operations.contrast} onChange={(event) => set("contrast", Number(event.target.value))} /><strong>{operations.contrast.toFixed(2)}</strong></label>
        <label><span>Saturation</span><input type="range" min="0" max="2" step="0.02" value={operations.saturation} onChange={(event) => set("saturation", Number(event.target.value))} /><strong>{operations.saturation.toFixed(2)}</strong></label>
        <label><span>Sharpen</span><input type="range" min="0" max="2" step="0.05" value={operations.sharpen} onChange={(event) => set("sharpen", Number(event.target.value))} /><strong>{operations.sharpen.toFixed(2)}</strong></label>
        <label><span>Blur</span><input type="range" min="0" max="12" step="1" value={operations.blur} onChange={(event) => set("blur", Number(event.target.value))} /><strong>{operations.blur.toFixed(0)}</strong></label>
      </div>

      <div className="editorChecks">
        <label><input type="checkbox" checked={operations.mute} onChange={(event) => set("mute", event.target.checked)} />Mute audio</label>
        <label><input type="checkbox" checked={operations.normalizeAudio} disabled={operations.mute} onChange={(event) => set("normalizeAudio", event.target.checked)} />Normalize loudness</label>
        <label><input type="checkbox" checked={operations.mirror} onChange={(event) => set("mirror", event.target.checked)} />Mirror horizontally</label>
        <label><input type="checkbox" checked={operations.vignette} onChange={(event) => set("vignette", event.target.checked)} />Cinematic vignette</label>
      </div>

      <div className="editorActions">
        <button type="button" className="secondaryEditButton" onClick={() => { setOperations(DEFAULTS); onPreviewChange(originalUrl); }}>Reset controls</button>
        <button type="button" className="primaryEditButton" onClick={applyEdit} disabled={Boolean(processingId)}>{processingId ? "Rendering edit..." : "Apply edit"}</button>
      </div>
      {error && <p className="editorError">{error}</p>}

      {(versions.length > 0 || originalUrl) && <div className="versionStrip">
        <strong>Versions</strong>
        <button type="button" onClick={() => onPreviewChange(originalUrl)}>Original</button>
        {versions.map((version, index) => <span className="versionPill" key={version.id}>
          <button type="button" disabled={!version.outputUrl} onClick={() => version.outputUrl && onPreviewChange(version.outputUrl)}>
            V{versions.length - index} · {version.status === "COMPLETED" ? `QC ${version.qcReport?.technicalScore ?? "-"}` : version.status.toLowerCase()}
          </button>
          <button className="versionDelete" type="button" aria-label={`Delete version ${versions.length - index}`} title="Delete edited version" disabled={["QUEUED", "PROCESSING"].includes(version.status)} onClick={() => void deleteVersion(version.id)}>×</button>
        </span>)}
      </div>}
    </div>}
  </div>;
}
