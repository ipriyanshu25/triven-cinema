"use client";

import { useState } from "react";
import { isActive, statusLabel, type Turn } from "./chat-model";
import { Icon } from "./icons";

export function GenerationMessage({ turn, busy, onRegenerate }: { turn: Turn; busy: boolean; onRegenerate: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const job = turn.job;
  const loading = isActive(turn.status);
  const failed = turn.status === "FAILED";
  const outputUrl = job?.outputUrl;
  const aspectRatio = job?.aspectRatio || turn.settings.aspectRatio;
  const progress = Math.max(0, Math.min(100, Math.round(job?.progress ?? 0)));

  async function download() {
    if (!outputUrl || downloading) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const response = await fetch(outputUrl);
      if (!response.ok) throw new Error("download");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `triven-${job?.id || turn.id}.mp4`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError(true); }
    finally { setDownloading(false); }
  }

  return <div className="assistantMessage">
    <span className="brandMark assistantMark" aria-hidden="true">T</span>
    <div className="assistantContent">
      <div className="assistantName">Triven Cinema</div>
      <h2 aria-live="polite">{failed ? "We couldn’t finish this render" : loading ? statusLabel(turn.status) : outputUrl ? "Your video is ready" : "Render completed"}</h2>
      {loading && <>
        <div className={`videoPlaceholder ratio-${aspectRatio.replace(":", "-")}`} aria-hidden="true"><div className="frameCorners" /><div className="placeholderCenter"><span className="renderMark">T</span><span>CREATING YOUR VIDEO</span><div className="renderDots"><i /><i /><i /></div></div></div>
        <div className="renderStatus"><span className="statusSpinner" /><span>{turn.connectionLost ? "Connection interrupted. Reconnecting…" : turn.status === "PLANNING" ? "Preparing scenes from your prompt" : turn.status === "STARTING" ? "Submitting your render" : turn.status === "QUEUED" ? "Waiting for the GPU" : turn.status === "STITCHING" ? "Joining your scenes" : turn.status === "UPLOADING" ? "Preparing the final video" : "LTX-2.5 is rendering your scene"}</span></div>
        {job && <div className="generationProgress">
          <div className="generationProgressInfo"><span>Video generation progress</span><strong>{progress}%</strong></div>
          <div className="generationProgressTrack" role="progressbar" aria-label="Video generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="generationProgressFill" style={{ width: `${progress}%` }} />
          </div>
        </div>}
        <p className="responseNote">This can take a few minutes. You can explore your other chats.</p>
      </>}
      {failed && <div className="failureCard"><p>The video couldn’t be completed. Try again, or adjust your prompt below.</p><button className="textAction" disabled={busy} onClick={onRegenerate}><Icon name="retry" size={16} />Try again</button></div>}
      {!loading && !failed && outputUrl && <>
        <div className={`videoFrame ratio-${aspectRatio.replace(":", "-")}`}><video key={outputUrl} src={outputUrl} controls playsInline preload="metadata" onError={() => setPlaybackError(true)} /></div>
        {playbackError && <p className="responseNote">The video couldn’t load. <a href={outputUrl} target="_blank" rel="noopener noreferrer">Open video directly</a></p>}
        <div className="resultMeta">{job.durationSeconds} sec<span>·</span>{job.aspectRatio}{job.model && <><span>·</span>{job.model.toUpperCase()}</>}</div>
        <div className="resultActions"><button className="textAction" onClick={download} disabled={downloading}><Icon name="download" size={16} />{downloading ? "Downloading…" : "Download"}</button><button className="textAction" disabled={busy} onClick={onRegenerate}><Icon name="retry" size={16} />Regenerate</button></div>
        {downloadError && <p className="responseNote" role="status">Direct download isn’t available from this host. <a href={outputUrl} target="_blank" rel="noopener noreferrer">Open the video to save it</a>.</p>}
      </>}
      {!loading && !failed && !outputUrl && <p className="responseNote">The render finished, but its video link is unavailable.</p>}
    </div>
  </div>;
}
