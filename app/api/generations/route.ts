import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generationSchema } from "@/lib/schemas";
import { enhanceVideoPrompt } from "@/lib/scene-planner";
import { submitModalJob } from "@/lib/modal";

const MOCK_MODE = process.env.MOCK_MODE === "true";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") || 8)));
  const rows = await prisma.generation.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { scenes: { orderBy: { order: "asc" } } } });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  try {
    const input = generationSchema.parse(await request.json());
    const enhancedPrompt = input.enhancePrompt ? await enhanceVideoPrompt(input.prompt, input.continuityContext) : input.prompt;
    const seed = input.seed ?? Math.floor(Math.random() * 2_147_483_647);
    const nativeAudio = input.audioQuality !== "off" && input.nativeAudio;

    const generation = await prisma.generation.create({
      data: {
        prompt: input.prompt,
        enhancedPrompt,
        mode: input.mode,
        model: input.model,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        durationSeconds: input.durationSeconds,
        nativeAudio,
        enhancePrompt: input.enhancePrompt,
        seed,
        status: MOCK_MODE ? "COMPLETED" : "QUEUED",
        progress: MOCK_MODE ? 100 : 2,
        statusMessage: MOCK_MODE ? "Mock render complete" : "Queued for GPU",
        outputUrl: MOCK_MODE ? "/demo/triven-cinema-demo.mp4" : null,
        gpuType: MOCK_MODE ? "MOCK" : "B200",
        gpuSeconds: MOCK_MODE ? 0 : null,
        actualCost: MOCK_MODE ? 0 : null,
        metadata: {
          continuityContext: input.continuityContext || null,
          videoType: input.videoType,
          renderMode: input.renderMode,
          resolution: input.resolution,
          fps: input.fps,
          audioQuality: input.audioQuality,
          mockMode: MOCK_MODE,
        },
        scenes: input.mode === "SCENES" && input.scenes ? {
          create: input.scenes.map(scene => ({ order: scene.order, title: scene.title, prompt: scene.prompt, duration: scene.duration, seed })),
        } : undefined,
      },
      include: { scenes: { orderBy: { order: "asc" } } },
    });

    if (MOCK_MODE) return NextResponse.json(generation, { status: 201 });

    try {
      const job = await submitModalJob({
        jobId: generation.id,
        prompt: enhancedPrompt,
        mode: input.mode,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        renderMode: input.renderMode,
        resolution: input.resolution,
        fps: input.fps,
        audioQuality: input.audioQuality,
        durationSeconds: input.durationSeconds,
        nativeAudio,
        seed,
        scenes: input.mode === "SCENES" ? input.scenes?.map((scene) => ({ ...scene, prompt: `${input.continuityContext ? `${input.continuityContext} ` : ""}${scene.prompt}` })) : undefined,
      });
      const updated = await prisma.generation.update({ where: { id: generation.id }, data: { providerJobId: job.callId }, include: { scenes: { orderBy: { order: "asc" } } } });
      return NextResponse.json(updated, { status: 201 });
    } catch (error) {
      const failed = await prisma.generation.update({ where: { id: generation.id }, data: { status: "FAILED", progress: 0, error: error instanceof Error ? error.message : "GPU job submission failed", statusMessage: "Could not start GPU job" }, include: { scenes: true } });
      return NextResponse.json(failed, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid generation request" }, { status: 400 });
  }
}
