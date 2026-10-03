import type { ModalJobState, ScenePlanItem } from "@/lib/types";

type SubmitInput = {
  jobId: string;
  prompt: string;
  mode: "DIRECT" | "SCENES";
  aspectRatio: "16:9" | "9:16" | "1:1";
  quality: "preview" | "1080p";
  durationSeconds: number;
  nativeAudio: boolean;
  seed: number;
  scenes?: ScenePlanItem[];
};

function config() {
  const base = process.env.MODAL_API_URL?.replace(/\/$/, "");
  const secret = process.env.MODAL_WEB_SECRET;
  if (!base || !secret) throw new Error("MODAL_API_URL and MODAL_WEB_SECRET must be configured when MOCK_MODE=false.");
  return { base, secret };
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
