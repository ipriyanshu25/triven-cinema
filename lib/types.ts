export type GenerationMode = "DIRECT" | "SCENES";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Quality = "preview" | "1080p";

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
