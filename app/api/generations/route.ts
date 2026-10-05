import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generationSchema } from "@/lib/schemas";
import { analyzeVideoPrompt, enhanceVideoPrompt } from "@/lib/scene-planner";
import { submitModalJob } from "@/lib/modal";
import type { ScenePlanItem } from "@/lib/types";

const MOCK_MODE = process.env.MOCK_MODE === "true";
const MAX_ACTIVE_GENERATIONS = Math.max(1, Number(process.env.TRIVEN_MAX_ACTIVE_GENERATIONS || 2));
const ACTIVE_STALE_HOURS = Math.max(1, Number(process.env.TRIVEN_ACTIVE_STALE_HOURS || 6));

function clipLimit(renderMode: "fast" | "pro", resolution: string, fps: number) {
  return renderMode === "pro" || resolution === "1440p" || resolution === "4k" || fps >= 30 ? 10 : 20;
}

function normalizeScenesForProfile(
  scenes: ScenePlanItem[] | undefined,
  renderMode: "fast" | "pro",
  resolution: string,
  fps: number,
): ScenePlanItem[] | undefined {
  if (!scenes?.length) return undefined;
  const limit = clipLimit(renderMode, resolution, fps);
  const output: ScenePlanItem[] = [];
  for (const scene of scenes) {
    const chunks = Math.max(1, Math.ceil(scene.duration / limit));
    let remaining = scene.duration;
    for (let index = 0; index < chunks; index += 1) {
      const duration = Math.min(limit, remaining);
      remaining -= duration;
      output.push({
        ...scene,
        order: output.length + 1,
        title: chunks > 1 ? `${scene.title} - part ${index + 1}` : scene.title,
        duration,
        prompt: chunks > 1
          ? `${scene.prompt} This is a continuous extension of the same moment; begin from the preceding visual state and advance the action naturally while keeping identities, wardrobe, environment, lighting and screen direction unchanged.`
          : scene.prompt,
      });
    }
  }
  return output;
}

const includeGeneration = {
  scenes: { orderBy: { order: "asc" as const } },
  versions: { orderBy: { createdAt: "desc" as const } },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const rows = await prisma.generation.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: includeGeneration });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  try {
    const input = generationSchema.parse(await request.json());

    if (input.clientRequestId) {
      const existing = await prisma.generation.findUnique({ where: { clientRequestId: input.clientRequestId }, include: includeGeneration });
      if (existing) return NextResponse.json(existing, { status: 200 });
    }

    if (!MOCK_MODE) {
      const active = await prisma.generation.count({
        where: {
          status: { in: ["QUEUED", "PLANNING", "GENERATING", "STITCHING", "UPLOADING", "ANALYZING", "CANCEL_REQUESTED"] },
          updatedAt: { gte: new Date(Date.now() - ACTIVE_STALE_HOURS * 60 * 60 * 1000) },
        },
      });
      if (active >= MAX_ACTIVE_GENERATIONS) {
        return NextResponse.json({ error: `Render capacity is busy (${active}/${MAX_ACTIVE_GENERATIONS}). Wait for an active render to finish or stop it before starting another.` }, { status: 429 });
      }
    }

    const analysis = input.productionBrief || analyzeVideoPrompt(input.prompt);
    const enhancedPrompt = input.enhancePrompt ? await enhanceVideoPrompt(input.prompt, input.continuityContext || analysis.continuity) : input.prompt;
    const seed = input.seed ?? Math.floor(Math.random() * 2_147_483_647);
    const nativeAudio = input.audioQuality !== "off" && input.nativeAudio;
    const normalizedScenes = input.mode === "SCENES"
      ? normalizeScenesForProfile(input.scenes, input.renderMode, input.resolution, input.fps)
      : undefined;

    let generation: Prisma.GenerationGetPayload<{ include: typeof includeGeneration }>;
    try {
      generation = await prisma.generation.create({
      data: {
        clientRequestId: input.clientRequestId,
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
        thumbnailUrl: null,
        gpuType: MOCK_MODE ? "MOCK" : "B200",
        gpuSeconds: MOCK_MODE ? 0 : null,
        actualCost: MOCK_MODE ? 0 : null,
        analysis: analysis as Prisma.InputJsonValue,
        metadata: {
          continuityContext: input.continuityContext || analysis.continuity,
          videoType: input.videoType,
          renderMode: input.renderMode,
          resolution: input.resolution,
          fps: input.fps,
          audioQuality: input.audioQuality,
          continuityMode: input.continuityMode,
          storyAccuracy: input.storyAccuracy,
          directorSource: analysis.source || "deterministic",
          mockMode: MOCK_MODE,
          profileClipLimitSeconds: clipLimit(input.renderMode, input.resolution, input.fps),
        },
        scenes: input.mode === "SCENES" && normalizedScenes ? {
          create: normalizedScenes.map((scene) => ({
            order: scene.order,
            title: scene.title,
            prompt: scene.prompt,
            duration: scene.duration,
            seed,
            metadata: {
              visual: scene.visual || null,
              action: scene.action || null,
              camera: scene.camera || null,
              audio: scene.audio || null,
              dialogue: scene.dialogue || null,
              narration: scene.narration || null,
              storyBeat: scene.storyBeat || null,
              charactersPresent: scene.charactersPresent || [],
              sourceExcerpt: scene.sourceExcerpt || null,
              negativePrompt: scene.negativePrompt || null,
              transition: scene.transition || null,
              mustHave: scene.mustHave || [],
              memory: scene.memory || null,
            },
          })),
        } : undefined,
      },
      include: includeGeneration,
    });
    } catch (error) {
      if (input.clientRequestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.generation.findUnique({ where: { clientRequestId: input.clientRequestId }, include: includeGeneration });
        if (existing) return NextResponse.json(existing, { status: 200 });
      }
      throw error;
    }

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
        continuityMode: input.continuityMode,
        storyAccuracy: input.storyAccuracy,
        videoType: input.videoType,
        seed,
        scenes: input.mode === "SCENES" ? normalizedScenes?.map((scene) => ({
          ...scene,
          prompt: scene.prompt.slice(0, 11800),
        })) : undefined,
      });

      await prisma.renderAttempt.create({
        data: { generationId: generation.id, providerJobId: job.callId, status: "QUEUED" },
      });

      const updated = await prisma.generation.update({
        where: { id: generation.id },
        data: { providerJobId: job.callId },
        include: includeGeneration,
      });
      return NextResponse.json(updated, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GPU job submission failed";
      await prisma.renderAttempt.create({
        data: { generationId: generation.id, status: "FAILED", error: message, finishedAt: new Date() },
      });
      const failed = await prisma.generation.update({
        where: { id: generation.id },
        data: { status: "FAILED", progress: 0, error: message, statusMessage: "Could not start GPU job" },
        include: includeGeneration,
      });
      return NextResponse.json(failed, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid generation request" }, { status: 400 });
  }
}
