import type {
  AudioQuality,
  ContinuityMode,
  FrameRate,
  ModalEditState,
  ModalJobState,
  RenderMode,
  Resolution,
  ScenePlanItem,
  StoryAccuracy,
  StoredQuality,
  VideoEditOperations,
  VideoType,
} from "@/lib/types";

type SubmitInput = {
  jobId: string;
  prompt: string;
  mode: "DIRECT" | "SCENES";
  aspectRatio: "16:9" | "9:16" | "1:1";
  quality: StoredQuality;
  renderMode: RenderMode;
  resolution: Resolution;
  fps: FrameRate;
  audioQuality: AudioQuality;
  durationSeconds: number;
  nativeAudio: boolean;
  continuityMode: ContinuityMode;
  storyAccuracy: StoryAccuracy;
  videoType: VideoType;
  seed: number;
  scenes?: ScenePlanItem[];
};


type DirectorPlanInput = {
  prompt: string;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  videoType: VideoType;
  continuityMode: ContinuityMode;
  storyAccuracy: StoryAccuracy;
};

type EditSubmitInput = {
  generationId: string;
  versionId: string;
  sourceUrl?: string | null;
  operations: VideoEditOperations;
};

function config() {
  const base = process.env.MODAL_API_URL?.replace(/\/$/, "");
  const secret = process.env.MODAL_WEB_SECRET;
  if (!base || !secret) throw new Error("MODAL_API_URL and MODAL_WEB_SECRET must be configured when MOCK_MODE=false.");
  return { base, secret };
}

export async function planModalStory(input: DirectorPlanInput): Promise<Record<string, unknown>> {
  const { base, secret } = config();
  const response = await fetch(`${base}/director/plan`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-triven-secret": secret },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Modal Director failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function submitModalJob(input: SubmitInput): Promise<{ callId: string }> {
  const { base, secret } = config();
  const response = await fetch(`${base}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-triven-secret": secret },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Modal submit failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function getModalJob(jobId: string): Promise<ModalJobState> {
  const { base, secret } = config();
  const response = await fetch(`${base}/status/${encodeURIComponent(jobId)}`, {
    headers: { "x-triven-secret": secret },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Modal status failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function cancelModalJob(jobId: string): Promise<ModalJobState> {
  const { base, secret } = config();
  const response = await fetch(`${base}/cancel/${encodeURIComponent(jobId)}`, {
    method: "POST",
    headers: { "x-triven-secret": secret },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Modal cancel failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function submitModalEdit(input: EditSubmitInput): Promise<{ callId: string }> {
  const { base, secret } = config();
  const response = await fetch(`${base}/edit/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-triven-secret": secret },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Modal edit submit failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function getModalEdit(versionId: string): Promise<ModalEditState> {
  const { base, secret } = config();
  const response = await fetch(`${base}/edit/status/${encodeURIComponent(versionId)}`, {
    headers: { "x-triven-secret": secret },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Modal edit status failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function getModalHealth(): Promise<Record<string, unknown>> {
  const { base } = config();
  const response = await fetch(`${base}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Modal health failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function deleteModalGeneration(jobId: string): Promise<{ ok: boolean; jobId: string }> {
  const { base, secret } = config();
  const response = await fetch(`${base}/delete/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    headers: { "x-triven-secret": secret },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Modal delete failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function deleteModalEditVersion(generationId: string, versionId: string): Promise<{ ok: boolean }> {
  const { base, secret } = config();
  const response = await fetch(`${base}/edit/delete/${encodeURIComponent(generationId)}/${encodeURIComponent(versionId)}`, {
    method: "DELETE",
    headers: { "x-triven-secret": secret },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Modal edit delete failed (${response.status}): ${await response.text()}`);
  return response.json();
}
