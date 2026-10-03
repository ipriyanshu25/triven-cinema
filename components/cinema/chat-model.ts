import type { AspectRatio, Quality, ScenePlanItem } from "@/lib/types";

export type PromptSettings = {
  mode: "DIRECT" | "SCENES";
  aspectRatio: AspectRatio;
  quality: Quality;
  durationSeconds: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function inferPromptSettings(prompt: string): PromptSettings {
  const normalized = prompt.replace(/[–—]/g, "-");

  let aspectRatio: AspectRatio = "16:9";
  if (/9\s*[:x×]\s*16|1080\s*[x×]\s*1920|vertical|portrait/i.test(normalized)) aspectRatio = "9:16";
  else if (/1\s*[:x×]\s*1|square/i.test(normalized)) aspectRatio = "1:1";

  let durationSeconds = 10;
  const totalDuration = normalized.match(/(?:total\s+(?:video\s+)?duration\s*[:=-]?\s*(?:approximately\s*)?|create\s+a\s+)(\d{1,3})\s*(?:-|\s)?seconds?/i);
  const genericDuration = normalized.match(/\b(\d{1,3})\s*(?:-|\s)?seconds?\b/i);
  const sceneRanges = [...normalized.matchAll(/SCENE\s+\d+[^\n]*?(\d{1,3})\s*-\s*(\d{1,3})\s*seconds?/gi)];

  if (totalDuration?.[1]) durationSeconds = Number(totalDuration[1]);
  else if (sceneRanges.length) durationSeconds = Math.max(...sceneRanges.map((match) => Number(match[2])));
  else if (genericDuration?.[1]) durationSeconds = Number(genericDuration[1]);

  durationSeconds = clamp(durationSeconds, 5, 60);

  const hasExplicitScenes = /(?:^|\n)\s*(?:#{1,6}\s*)?SCENE\s+\d+/im.test(normalized);
  const mode: "DIRECT" | "SCENES" = hasExplicitScenes || durationSeconds > 20 ? "SCENES" : "DIRECT";
  const quality: Quality = /1080|1920|high[- ]quality|high quality/i.test(normalized) ? "1080p" : "preview";

  return { mode, aspectRatio, quality, durationSeconds };
}

export function statusLabel(status?: string) {
  switch (status) {
    case "QUEUED": return "Preparing your render";
    case "PLANNING": return "Breaking the story into scenes";
    case "GENERATING": return "Generating video with LTX-2.5";
    case "STITCHING": return "Joining your scenes";
    case "UPLOADING": return "Preparing the final video";
    case "COMPLETED": return "Your video is ready";
    case "FAILED": return "Generation failed";
    default: return "Preparing your video";
  }
}


export type Generation = PromptSettings & {
  id: string;
  prompt: string;
  model?: string;
  nativeAudio: boolean;
  enhancePrompt?: boolean;
  status: string;
  progress?: number | null;
  outputUrl?: string | null;
  createdAt: string;
  scenes?: ScenePlanItem[];
  metadata?: { continuityContext?: string | null };
};

export type Turn = {
  id: string;
  prompt: string;
  settings: PromptSettings;
  status: string;
  job?: Generation;
  connectionLost?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  turns: Turn[];
};

export function conversationTitle(prompt: string) {
  const clean = prompt.replace(/[*#_`]/g, "").replace(/^(?:please\s+)?(?:create|generate|make)\s+(?:(?:me|a|an)\s+)*/i, "").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").slice(0, 7).join(" ");
  return (words.length > 48 ? `${words.slice(0, 47).trim()}…` : words) || "Untitled video";
}

export function isActive(status: string) {
  return !["COMPLETED", "FAILED"].includes(status);
}

export function turnFromJob(job: Generation): Turn {
  return { id: job.id, prompt: job.prompt, settings: job, status: job.status, job };
}
