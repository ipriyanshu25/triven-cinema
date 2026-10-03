"use client";

import { useEffect, useRef, useState } from "react";
import type { AspectRatio, AudioQuality, FrameRate, RenderMode, Resolution, VideoType } from "@/lib/types";
import {
  audioQualityLabel,
  inferPromptSettings,
  outputResolution,
  renderModeLabel,
  videoTypeLabel,
  type PromptSettings,
} from "./chat-model";
import { Icon } from "./icons";

type VideoTypeSelection = VideoType | "auto";
type AspectSelection = AspectRatio | "auto";
type RenderModeSelection = RenderMode | "auto";
type ResolutionSelection = Resolution | "auto";
type FpsSelection = FrameRate | "auto";
type AudioSelection = AudioQuality | "auto";
type DurationSelection = 5 | 10 | 15 | 30 | 60 | "auto";

export type ComposerEditDraft = {
  id: string;
  prompt: string;
  settings: PromptSettings;
};

export function PromptComposer({
  chatMode,
  busy,
  ready,
  onSubmit,
  onStop,
  editDraft,
  onEditDraftApplied,
}: {
  chatMode: boolean;
  busy: boolean;
  ready: boolean;
  onSubmit: (prompt: string, settings: PromptSettings) => boolean;
  onStop: () => void;
  editDraft?: ComposerEditDraft | null;
  onEditDraftApplied?: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [videoType, setVideoType] = useState<VideoTypeSelection>("auto");
  const [aspectRatio, setAspectRatio] = useState<AspectSelection>("auto");
  const [renderMode, setRenderMode] = useState<RenderModeSelection>("auto");
  const [resolution, setResolution] = useState<ResolutionSelection>("auto");
  const [fps, setFps] = useState<FpsSelection>("auto");
  const [duration, setDuration] = useState<DurationSelection>("auto");
  const [audioQuality, setAudioQuality] = useState<AudioSelection>("auto");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const settings = inferPromptSettings(prompt, {
    videoType,
    aspectRatio,
    renderMode,
    resolution,
    fps,
    durationSeconds: duration,
    audioQuality,
  });
  const canSubmit = ready && !busy && prompt.trim().length >= 5 && prompt.trim().length <= 8000;
  const hasPrompt = prompt.trim().length >= 5;

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(220, Math.max(chatMode ? 64 : 112, element.scrollHeight))}px`;
  }, [prompt, chatMode]);

  useEffect(() => {
    if (!editDraft) return;

    const applyTimer = window.setTimeout(() => {
      setPrompt(editDraft.prompt);
      setVideoType(editDraft.settings.videoType);
      setAspectRatio(editDraft.settings.aspectRatio);
      setRenderMode(editDraft.settings.renderMode);
      setResolution(editDraft.settings.resolution);
      setFps(editDraft.settings.fps);
      setDuration([5, 10, 15, 30, 60].includes(editDraft.settings.durationSeconds) ? editDraft.settings.durationSeconds as DurationSelection : "auto");
      setAudioQuality(editDraft.settings.audioQuality);
      onEditDraftApplied?.();

      window.requestAnimationFrame(() => {
        textarea.current?.focus();
        textarea.current?.setSelectionRange(editDraft.prompt.length, editDraft.prompt.length);
      });
    }, 0);

    return () => window.clearTimeout(applyTimer);
  }, [editDraft, onEditDraftApplied]);

  function send() {
    if (canSubmit && onSubmit(prompt, settings)) {
      setPrompt("");
      textarea.current?.focus();
    }
  }

  return <div className={`composerDock ${chatMode ? "chatDock" : ""}`}>
    <form className="composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <div className="composerInputWrap">
        <textarea
          ref={textarea}
          aria-label="Describe your video"
          value={prompt}
          maxLength={8000}
          rows={2}
          placeholder={chatMode ? "Describe the next video you want to create..." : "Describe a scene, story, ad or idea..."}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
        />
      </div>

      {hasPrompt && <div className="composerDetection" aria-live="polite">
        <span className="detectionLabel">Detected</span>
        <strong>{videoTypeLabel(settings.videoType)}</strong>
        <span>-</span>
        <span>{settings.mode === "SCENES" ? "Multi-scene" : "Single scene"}</span>
        <span>-</span>
        <span>{renderModeLabel(settings.renderMode)}</span>
        <span>-</span>
        <span>{outputResolution(settings.aspectRatio, settings.resolution)}</span>
        <span>-</span>
        <span>{settings.fps} FPS</span>
        <span>-</span>
        <span>{settings.durationSeconds}s</span>
        <span>-</span>
        <span>{audioQualityLabel(settings.audioQuality)}</span>
      </div>}

      <div className="composerControls" aria-label="Video generation settings">
        <label className="composerControl wideControl">
          <span>Video type</span>
          <select value={videoType} onChange={(event) => setVideoType(event.target.value as VideoTypeSelection)} aria-label="Video type">
            <option value="auto">Auto</option>
            <option value="cartoon">Cartoon / Animation</option>
            <option value="story">Story</option>
            <option value="cinematic">Cinematic</option>
            <option value="product-ad">Product Ad</option>
            <option value="explainer">Explainer</option>
            <option value="social">Social Video</option>
          </select>
        </label>

        <label className="composerControl compactControl">
          <span>Frame</span>
          <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectSelection)} aria-label="Aspect ratio">
            <option value="auto">Auto</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
          </select>
        </label>

        <label className="composerControl">
          <span>Mode</span>
          <select value={renderMode} onChange={(event) => setRenderMode(event.target.value as RenderModeSelection)} aria-label="LTX render mode">
            <option value="auto">Auto</option>
            <option value="fast">Fast - Distilled</option>
            <option value="pro">Pro - Full / SFT</option>
          </select>
        </label>

        <label className="composerControl">
          <span>Resolution</span>
          <select value={resolution} onChange={(event) => setResolution(event.target.value as ResolutionSelection)} aria-label="Video resolution">
            <option value="auto">Auto</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="1440p">1440p</option>
            <option value="4k">4K</option>
          </select>
        </label>

        <label className="composerControl compactControl">
          <span>FPS</span>
          <select
            value={fps}
            onChange={(event) => setFps(event.target.value === "auto" ? "auto" : Number(event.target.value) as FrameRate)}
            aria-label="Frames per second"
          >
            <option value="auto">Auto</option>
            <option value="24">24 FPS</option>
            <option value="25">25 FPS</option>
            <option value="30">30 FPS</option>
            <option value="48">48 FPS</option>
            <option value="50">50 FPS</option>
          </select>
        </label>

        <label className="composerControl compactControl">
          <span>Duration</span>
          <select
            value={duration}
            onChange={(event) => setDuration(event.target.value === "auto" ? "auto" : Number(event.target.value) as DurationSelection)}
            aria-label="Video duration"
          >
            <option value="auto">Auto</option>
            <option value="5">5 sec</option>
            <option value="10">10 sec</option>
            <option value="15">15 sec</option>
            <option value="30">30 sec</option>
            <option value="60">60 sec</option>
          </select>
        </label>

        <label className="composerControl audioControl">
          <span>Audio</span>
          <select value={audioQuality} onChange={(event) => setAudioQuality(event.target.value as AudioSelection)} aria-label="Audio quality">
            <option value="auto">Auto</option>
            <option value="off">Off</option>
            <option value="standard">Native</option>
            <option value="high">Native HQ</option>
          </select>
        </label>

        <div className="composerSpacer" />
        <div className="composerEngine" title="Video model"><Icon name="film" size={15} /><span>LTX-2.5 {renderModeLabel(settings.renderMode)}</span></div>
        <button
          className={`sendButton ${busy ? "stopGenerationButton" : ""}`}
          type={busy ? "button" : "submit"}
          disabled={busy ? !ready : !canSubmit}
          aria-label={busy ? "Stop generation" : "Generate video"}
          title={busy ? "Stop generation" : "Generate video (Cmd / Ctrl + Enter)"}
          onClick={busy ? onStop : undefined}
        ><Icon name={busy ? "pause" : "arrow"} /></button>
      </div>
    </form>

    <p className="composerHint">
      {!ready
        ? "Loading your workspace..."
        : busy
          ? "Your video is rendering. Use the pause button to stop this render, then edit the prompt or generate again."
          : prompt.length > 0 && prompt.trim().length < 5
            ? "Add a little more detail - at least 5 characters."
            : "Choose Fast or Pro, resolution, FPS and native audio. Auto can infer them from your prompt."}
    </p>
  </div>;
}
