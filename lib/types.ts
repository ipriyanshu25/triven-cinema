export type GenerationMode = "DIRECT" | "SCENES";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Quality = "draft" | "standard" | "high" | "ultra";
export type StoredQuality = Quality | "preview" | "1080p";
export type VideoType = "cartoon" | "story" | "cinematic" | "product-ad" | "explainer" | "social";
export type RenderMode = "fast" | "pro";
export type Resolution = "720p" | "1080p" | "1440p" | "4k";
export type FrameRate = 24 | 25 | 30 | 48 | 50;
export type AudioQuality = "off" | "standard" | "high";

export type ScenePlanItem = {
  order: number;
  title: string;
  prompt: string;
  duration: number;
};

export type ScenePlan = {
  summary: string;
  continuityContext: string;
  scenes: ScenePlanItem[];
};

export type ModalJobState = {
  jobId: string;
  status: "QUEUED" | "GENERATING" | "STITCHING" | "UPLOADING" | "COMPLETED" | "FAILED";
  progress?: number;
  message?: string;
  outputUrl?: string;
  gpuSeconds?: number;
  actualCost?: number;
  error?: string;
};
