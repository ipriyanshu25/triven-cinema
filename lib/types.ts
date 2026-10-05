export type GenerationMode = "DIRECT" | "SCENES";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Quality = "draft" | "standard" | "high" | "ultra";
export type StoredQuality = Quality | "preview" | "1080p";
export type VideoType = "cartoon" | "story" | "devotional" | "cinematic" | "product-ad" | "explainer" | "social";
export type RenderMode = "fast" | "pro";
export type Resolution = "720p" | "1080p" | "1440p" | "4k";
export type FrameRate = 24 | 25 | 30 | 48 | 50;
export type AudioQuality = "off" | "standard" | "high";
export type ContinuityMode = "creative" | "balanced" | "strict";
export type StoryAccuracy = "standard" | "high";
export type GenerationStatus =
  | "QUEUED"
  | "PLANNING"
  | "GENERATING"
  | "STITCHING"
  | "UPLOADING"
  | "ANALYZING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export type CharacterBibleEntry = {
  name: string;
  role?: string;
  appearance: string;
  wardrobe?: string;
  voice?: string;
  immutableTraits: string[];
};

export type StoryArc = {
  setup: string;
  development: string;
  climax: string;
  resolution: string;
};

export type SceneSemanticReview = {
  score: number;
  promptAdherence: number;
  characterConsistency: number;
  visibleText: boolean;
  unrelatedSubjects: boolean;
  issues: string[];
  correction?: string;
};

export type SceneMemory = {
  characterLock: string;
  worldLock: string;
  previousSceneSummary?: string;
  carryForward: string[];
  allowedChanges: string[];
  bridgeFromPrevious: boolean;
  identityAnchors?: string[];
};

export type ScenePlanItem = {
  order: number;
  title: string;
  prompt: string;
  duration: number;
  visual?: string;
  action?: string;
  camera?: string;
  audio?: string;
  dialogue?: string;
  transition?: string;
  mustHave?: string[];
  storyBeat?: string;
  narration?: string;
  charactersPresent?: string[];
  sourceExcerpt?: string;
  negativePrompt?: string;
  memory?: SceneMemory;
};

export type ProductionBrief = {
  title: string;
  source?: "deterministic" | "ai-director";
  intent: string;
  visualStyle: string;
  characters: string[];
  locations: string[];
  cameraLanguage: string;
  audioDirection: string;
  mustHave: string[];
  avoid: string[];
  continuity: string;
  warnings: string[];
  storyArc?: StoryArc;
  characterBible?: CharacterBibleEntry[];
  sourceSummary?: string;
  narrationStyle?: string;
};

export type ScenePlan = {
  summary: string;
  continuityContext: string;
  productionBrief: ProductionBrief;
  scenes: ScenePlanItem[];
};

export type QCIssue = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

export type QCReport = {
  technicalScore: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string | null;
  audioChannels?: number | null;
  meanVolumeDb?: number | null;
  maxVolumeDb?: number | null;
  sampledLumaAverage?: number | null;
  sampledSaturationAverage?: number | null;
  blackSegments?: number;
  freezeSegments?: number;
  silenceSegments?: number;
  fileSizeBytes?: number;
  issues: QCIssue[];
};

export type EditPreset = "custom" | "cinematic" | "vivid" | "social" | "clean";
export type CropPreset = "original" | "16:9" | "9:16" | "1:1";

export type VideoEditOperations = {
  preset: EditPreset;
  trimStart: number;
  trimEnd?: number | null;
  speed: number;
  volume: number;
  mute: boolean;
  fadeIn: number;
  fadeOut: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  blur: number;
  vignette: boolean;
  normalizeAudio: boolean;
  crop: CropPreset;
  rotate: 0 | 90 | 180 | 270;
  mirror: boolean;
};

export type VideoVersionState = {
  id: string;
  generationId: string;
  label: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  outputUrl?: string | null;
  thumbnailUrl?: string | null;
  operations: VideoEditOperations;
  qcReport?: QCReport | null;
  error?: string | null;
  createdAt: string;
};

export type ModalJobState = {
  jobId: string;
  status: GenerationStatus;
  progress?: number;
  message?: string;
  outputUrl?: string;
  thumbnailUrl?: string;
  gpuSeconds?: number;
  actualCost?: number;
  qcReport?: QCReport;
  error?: string;
  callId?: string;
  cancelRequested?: boolean;
  sceneReviews?: SceneSemanticReview[];
};

export type ModalEditState = {
  versionId: string;
  generationId: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress?: number;
  message?: string;
  outputUrl?: string;
  thumbnailUrl?: string;
  qcReport?: QCReport;
  error?: string;
  callId?: string;
};
