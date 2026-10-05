import type {
  AspectRatio,
  AudioQuality,
  ContinuityMode,
  FrameRate,
  ProductionBrief,
  QCReport,
  Quality,
  RenderMode,
  Resolution,
  ScenePlanItem,
  StoryAccuracy,
  StoredQuality,
  VideoType,
  VideoVersionState,
} from "@/lib/types";

export type PromptSettings = {
  mode: "DIRECT" | "SCENES";
  aspectRatio: AspectRatio;
  quality: Quality;
  renderMode: RenderMode;
  resolution: Resolution;
  fps: FrameRate;
  audioQuality: AudioQuality;
  durationSeconds: number;
  videoType: VideoType;
  nativeAudio: boolean;
  continuityMode: ContinuityMode;
  storyAccuracy: StoryAccuracy;
};

export type PromptOverrides = {
  videoType?: VideoType | "auto";
  aspectRatio?: AspectRatio | "auto";
  quality?: Quality | "auto";
  renderMode?: RenderMode | "auto";
  resolution?: Resolution | "auto";
  fps?: FrameRate | "auto";
  audioQuality?: AudioQuality | "auto";
  durationSeconds?: number | "auto";
  nativeAudio?: boolean;
  mode?: "DIRECT" | "SCENES" | "auto";
  continuityMode?: ContinuityMode | "auto";
  storyAccuracy?: StoryAccuracy | "auto";
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function detectVideoType(prompt: string): VideoType {
  const normalized = prompt.toLowerCase();
  if (/\b(?:devotional|bhakti|spiritual|mythological|radha|krishna|vrindavan|yamuna|govardhan|deity|temple)\b/.test(normalized)) return "devotional";
  if (/cartoon|animation|animated|3d\s+animated|kids?\s+animation|children'?s?\s+cartoon/.test(normalized)) return "cartoon";
  if (/product\s*(?:ad|advert|advertisement)|commercial|ugc\s+ad|brand\s+ad|product\s+launch/.test(normalized)) return "product-ad";
  if (/explainer|explain\s+how|how\s+it\s+works|tutorial|walkthrough|educational\s+video/.test(normalized)) return "explainer";
  if (/instagram\s+reel|reels?|tiktok|youtube\s+short|shorts?|social\s+(?:media\s+)?video/.test(normalized)) return "social";
  if (/story|storytelling|narrative|episode|chapter|scene\s+\d+/.test(normalized)) return "story";
  return "cinematic";
}

export function videoTypeLabel(type: VideoType) {
  switch (type) {
    case "cartoon": return "Cartoon / Animation";
    case "story": return "Story";
    case "devotional": return "Devotional Story";
    case "product-ad": return "Product Ad";
    case "explainer": return "Explainer";
    case "social": return "Social Video";
    default: return "Cinematic";
  }
}

export function normalizeQuality(quality?: StoredQuality | string | null): Quality {
  switch (quality) {
    case "draft": return "draft";
    case "standard": return "standard";
    case "high":
    case "preview": return "high";
    case "ultra":
    case "1080p": return "ultra";
    default: return "standard";
  }
}

export function qualityLabel(quality: StoredQuality | string) {
  switch (normalizeQuality(quality)) {
    case "draft": return "Draft";
    case "standard": return "Standard";
    case "high": return "High";
    case "ultra": return "Ultra";
  }
}

export function renderModeLabel(mode: RenderMode) {
  return mode === "pro" ? "Pro" : "Fast";
}

export function resolutionLabel(resolution: Resolution) {
  switch (resolution) {
    case "720p": return "720p";
    case "1080p": return "1080p";
    case "1440p": return "1440p";
    case "4k": return "4K";
  }
}

export function audioQualityLabel(quality: AudioQuality) {
  switch (quality) {
    case "off": return "Audio Off";
    case "high": return "Native Audio HQ";
    default: return "Native Audio";
  }
}

export function outputResolution(aspectRatio: AspectRatio, resolution: Resolution) {
  const landscape: Record<Resolution, string> = { "720p": "1280x720", "1080p": "1920x1080", "1440p": "2560x1440", "4k": "3840x2160" };
  const portrait: Record<Resolution, string> = { "720p": "720x1280", "1080p": "1080x1920", "1440p": "1440x2560", "4k": "2160x3840" };
  const square: Record<Resolution, string> = { "720p": "720x720", "1080p": "1080x1080", "1440p": "1440x1440", "4k": "2160x2160" };
  if (aspectRatio === "9:16") return portrait[resolution];
  if (aspectRatio === "1:1") return square[resolution];
  return landscape[resolution];
}

export function maxSingleClipSeconds(renderMode: RenderMode, resolution: Resolution, fps: FrameRate) {
  if (renderMode === "pro" || resolution === "1440p" || resolution === "4k" || fps >= 30) return 10;
  return 20;
}

function legacyQualityForResolution(resolution: Resolution): Quality {
  return resolution === "720p" ? "high" : "ultra";
}

export function inferPromptSettings(prompt: string, overrides: PromptOverrides = {}): PromptSettings {
  const normalized = prompt.replace(/[–—]/g, "-");

  let inferredAspectRatio: AspectRatio = "16:9";
  if (/9\s*[:x×]\s*16|1080\s*[x×]\s*1920|vertical|portrait/i.test(normalized)) inferredAspectRatio = "9:16";
  else if (/1\s*[:x×]\s*1|square/i.test(normalized)) inferredAspectRatio = "1:1";
  const aspectRatio = overrides.aspectRatio && overrides.aspectRatio !== "auto" ? overrides.aspectRatio : inferredAspectRatio;

  let inferredDuration = 10;
  const totalDuration = normalized.match(/(?:total\s+(?:video\s+)?duration\s*[:=-]?\s*(?:approximately\s*)?|create\s+a\s+)(\d{1,3})\s*(?:-|\s)?seconds?/i);
  const genericDuration = normalized.match(/\b(\d{1,3})\s*(?:-|\s)?seconds?\b/i);
  const sceneRanges = [...normalized.matchAll(/SCENE\s+\d+[^\n]*?(\d{1,3})\s*-\s*(\d{1,3})\s*seconds?/gi)];
  if (totalDuration?.[1]) inferredDuration = Number(totalDuration[1]);
  else if (sceneRanges.length) inferredDuration = Math.max(...sceneRanges.map((match) => Number(match[2])));
  else if (genericDuration?.[1]) inferredDuration = Number(genericDuration[1]);
  const durationSeconds = clamp(overrides.durationSeconds && overrides.durationSeconds !== "auto" ? overrides.durationSeconds : inferredDuration, 5, 180);

  const detectedVideoType = detectVideoType(prompt);
  const videoType = overrides.videoType && overrides.videoType !== "auto" ? overrides.videoType : detectedVideoType;

  let inferredRenderMode: RenderMode = "fast";
  if (/\b(?:pro|production\s+quality|high[- ]fidelity|maximum\s+quality|max\s+quality|best\s+(?:possible\s+)?quality|premium\s+quality|final\s+master)\b/i.test(normalized)) inferredRenderMode = "pro";
  const renderMode = overrides.renderMode && overrides.renderMode !== "auto" ? overrides.renderMode : inferredRenderMode;

  let inferredResolution: Resolution = "1080p";
  if (/\b(?:4k|2160p|3840\s*[x×]\s*2160|2160\s*[x×]\s*3840)\b/i.test(normalized)) inferredResolution = "4k";
  else if (/\b(?:1440p|2k|2560\s*[x×]\s*1440|1440\s*[x×]\s*2560)\b/i.test(normalized)) inferredResolution = "1440p";
  else if (/\b(?:720p|1280\s*[x×]\s*720|720\s*[x×]\s*1280)\b/i.test(normalized)) inferredResolution = "720p";
  const resolution = overrides.resolution && overrides.resolution !== "auto" ? overrides.resolution : inferredResolution;

  let inferredFps: FrameRate = 24;
  const fpsMatch = normalized.match(/\b(24|25|30|48|50)\s*(?:fps|frames?\s+per\s+second)\b/i);
  if (fpsMatch?.[1]) inferredFps = Number(fpsMatch[1]) as FrameRate;
  const fps = overrides.fps && overrides.fps !== "auto" ? overrides.fps : inferredFps;

  let inferredAudioQuality: AudioQuality = "standard";
  if (/\b(?:silent|no\s+audio|without\s+(?:audio|sound)|mute)\b/i.test(normalized)) inferredAudioQuality = "off";
  else if (/\b(?:high[- ]quality\s+audio|hq\s+audio|studio\s+audio|premium\s+audio|crystal[- ]clear\s+(?:audio|dialogue|voice)|high[- ]quality\s+(?:dialogue|voice))\b/i.test(normalized)) inferredAudioQuality = "high";
  const audioQuality = overrides.audioQuality && overrides.audioQuality !== "auto" ? overrides.audioQuality : inferredAudioQuality;
  const nativeAudio = audioQuality !== "off" && (overrides.nativeAudio ?? true);

  const hasExplicitScenes = /(?:^|\n)\s*(?:#{1,6}\s*)?SCENE\s+\d+/im.test(normalized);
  const clipLimit = maxSingleClipSeconds(renderMode, resolution, fps);
  const inferredMode: "DIRECT" | "SCENES" = hasExplicitScenes || durationSeconds > clipLimit || (["story", "cartoon", "devotional"].includes(videoType) && durationSeconds > 10) ? "SCENES" : "DIRECT";
  const mode = overrides.mode && overrides.mode !== "auto" ? overrides.mode : inferredMode;
  const inferredContinuity: ContinuityMode = ["story", "cartoon", "devotional"].includes(videoType) ? "strict" : "balanced";
  const continuityMode = overrides.continuityMode && overrides.continuityMode !== "auto" ? overrides.continuityMode : inferredContinuity;
  const inferredStoryAccuracy: StoryAccuracy = ["story", "cartoon", "devotional"].includes(videoType) ? "high" : "standard";
  const storyAccuracy = overrides.storyAccuracy && overrides.storyAccuracy !== "auto" ? overrides.storyAccuracy : inferredStoryAccuracy;
  const quality = overrides.quality && overrides.quality !== "auto" ? overrides.quality : legacyQualityForResolution(resolution);

  return { mode, aspectRatio, quality, renderMode, resolution, fps, audioQuality, durationSeconds, videoType, nativeAudio, continuityMode, storyAccuracy };
}

export function statusLabel(status?: string) {
  switch (status) {
    case "STARTING": return "Submitting your render";
    case "QUEUED": return "Waiting for the GPU";
    case "PLANNING": return "Analyzing your brief and planning scenes";
    case "STOPPING":
    case "CANCEL_REQUESTED": return "Stopping generation";
    case "CANCELLED": return "Generation stopped";
    case "GENERATING": return "Generating video with LTX-2.5";
    case "STITCHING": return "Joining your scenes";
    case "ANALYZING": return "Inspecting technical video quality";
    case "UPLOADING": return "Publishing the final video";
    case "COMPLETED": return "Your video is ready";
    case "FAILED": return "Generation failed";
    default: return "Preparing your video";
  }
}

export type Generation = Omit<PromptSettings, "videoType" | "quality" | "renderMode" | "resolution" | "fps" | "audioQuality" | "continuityMode" | "storyAccuracy"> & {
  quality: StoredQuality;
  id: string;
  clientRequestId?: string | null;
  prompt: string;
  videoType?: VideoType;
  model?: string;
  enhancePrompt?: boolean;
  status: string;
  progress?: number | null;
  statusMessage?: string | null;
  error?: string | null;
  providerJobId?: string | null;
  outputUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt: string;
  scenes?: ScenePlanItem[];
  versions?: VideoVersionState[];
  analysis?: ProductionBrief | null;
  qcReport?: QCReport | null;
  metadata?: {
    continuityContext?: string | null;
    videoType?: VideoType | null;
    renderMode?: RenderMode | null;
    resolution?: Resolution | null;
    fps?: FrameRate | null;
    audioQuality?: AudioQuality | null;
    continuityMode?: ContinuityMode | null;
    storyAccuracy?: StoryAccuracy | null;
  };
};

export type Turn = {
  id: string;
  prompt: string;
  settings: PromptSettings;
  status: string;
  job?: Generation;
  connectionLost?: boolean;
};

export type Conversation = { id: string; title: string; createdAt: string; turns: Turn[] };

export function conversationTitle(prompt: string) {
  const clean = prompt.replace(/[*#_`]/g, "").replace(/^(?:please\s+)?(?:create|generate|make)\s+(?:(?:me|a|an)\s+)*/i, "").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").slice(0, 7).join(" ");
  return (words.length > 42 ? `${words.slice(0, 42).trim()}...` : words) || "Untitled video";
}

export function isActive(status: string) {
  return !["COMPLETED", "FAILED", "CANCELLED"].includes(status);
}

export function turnStatusFromJob(job: Generation) {
  if (job.status === "FAILED" && job.statusMessage === "Generation stopped by user") return "CANCELLED";
  return job.status;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeGenerationJob(job: Generation): Generation {
  if (!job.scenes?.length) return job;
  const scenes = job.scenes.map((scene) => {
    const stored = scene as ScenePlanItem & { metadata?: unknown };
    const metadata = asRecord(stored.metadata);
    return {
      ...scene,
      visual: scene.visual ?? (typeof metadata.visual === "string" ? metadata.visual : undefined),
      action: scene.action ?? (typeof metadata.action === "string" ? metadata.action : undefined),
      camera: scene.camera ?? (typeof metadata.camera === "string" ? metadata.camera : undefined),
      audio: scene.audio ?? (typeof metadata.audio === "string" ? metadata.audio : undefined),
      dialogue: scene.dialogue ?? (typeof metadata.dialogue === "string" ? metadata.dialogue : undefined),
      narration: scene.narration ?? (typeof metadata.narration === "string" ? metadata.narration : undefined),
      storyBeat: scene.storyBeat ?? (typeof metadata.storyBeat === "string" ? metadata.storyBeat : undefined),
      sourceExcerpt: scene.sourceExcerpt ?? (typeof metadata.sourceExcerpt === "string" ? metadata.sourceExcerpt : undefined),
      transition: scene.transition ?? (typeof metadata.transition === "string" ? metadata.transition : undefined),
      negativePrompt: scene.negativePrompt ?? (typeof metadata.negativePrompt === "string" ? metadata.negativePrompt : undefined),
      charactersPresent: scene.charactersPresent ?? (Array.isArray(metadata.charactersPresent) ? metadata.charactersPresent.filter((item): item is string => typeof item === "string") : undefined),
      mustHave: scene.mustHave ?? (Array.isArray(metadata.mustHave) ? metadata.mustHave.filter((item): item is string => typeof item === "string") : undefined),
      memory: scene.memory ?? (metadata.memory && typeof metadata.memory === "object" ? metadata.memory as ScenePlanItem["memory"] : undefined),
    };
  });
  return { ...job, scenes };
}

export function turnFromJob(job: Generation): Turn {
  job = normalizeGenerationJob(job);
  const inferred = inferPromptSettings(job.prompt);
  const renderMode = job.metadata?.renderMode || inferred.renderMode;
  const resolution = job.metadata?.resolution || inferred.resolution;
  const fps = job.metadata?.fps || inferred.fps;
  const audioQuality = job.metadata?.audioQuality || (job.nativeAudio ? "standard" : "off");
  const continuityMode = job.metadata?.continuityMode || inferred.continuityMode;
  const storyAccuracy = job.metadata?.storyAccuracy || inferred.storyAccuracy;
  const settings: PromptSettings = {
    mode: job.mode,
    aspectRatio: job.aspectRatio,
    quality: normalizeQuality(job.quality),
    renderMode,
    resolution,
    fps,
    audioQuality,
    durationSeconds: job.durationSeconds,
    nativeAudio: audioQuality !== "off" && job.nativeAudio,
    videoType: job.videoType || job.metadata?.videoType || inferred.videoType,
    continuityMode,
    storyAccuracy,
  };
  return { id: job.id, prompt: job.prompt, settings, status: turnStatusFromJob(job), job };
}
