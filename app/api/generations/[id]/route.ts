import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteModalGeneration, getModalJob } from "@/lib/modal";
import type { GenerationStatus } from "@/lib/types";

const MOCK_MODE = process.env.MOCK_MODE === "true";
const TERMINAL: GenerationStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];
const modalToDb: Record<string, GenerationStatus> = {
  QUEUED: "QUEUED",
  PLANNING: "PLANNING",
  GENERATING: "GENERATING",
  STITCHING: "STITCHING",
  UPLOADING: "UPLOADING",
  ANALYZING: "ANALYZING",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};

const includeGeneration = {
  scenes: { orderBy: { order: "asc" as const } },
  versions: { orderBy: { createdAt: "desc" as const } },
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let generation = await prisma.generation.findUnique({ where: { id }, include: includeGeneration });
  if (!generation) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  if (!MOCK_MODE && !TERMINAL.includes(generation.status as GenerationStatus)) {
    try {
      const remote = await getModalJob(id);
      const nextStatus = modalToDb[remote.status] || generation.status;
      generation = await prisma.generation.update({
        where: { id },
        data: {
          status: nextStatus,
          progress: remote.progress ?? generation.progress,
          statusMessage: remote.message ?? generation.statusMessage,
          outputUrl: remote.outputUrl ?? generation.outputUrl,
          thumbnailUrl: remote.thumbnailUrl ?? generation.thumbnailUrl,
          gpuSeconds: remote.gpuSeconds ?? generation.gpuSeconds,
          actualCost: remote.actualCost ?? generation.actualCost,
          qcReport: remote.qcReport ? remote.qcReport as Prisma.InputJsonValue : undefined,
          error: remote.error ?? generation.error,
        },
        include: includeGeneration,
      });

      if (generation.providerJobId) {
        await prisma.renderAttempt.updateMany({
          where: { generationId: id, providerJobId: generation.providerJobId, finishedAt: null },
          data: {
            status: nextStatus,
            error: remote.error ?? null,
            finishedAt: TERMINAL.includes(nextStatus as GenerationStatus) ? new Date() : undefined,
          },
        });
      }
    } catch (error) {
      console.error("Modal status sync failed", error);
    }
  }

  return NextResponse.json(generation);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const generation = await prisma.generation.findUnique({ where: { id }, select: { status: true } });
    if (!generation) return NextResponse.json({ success: true, deleted: false });
    if (!["COMPLETED", "FAILED", "CANCELLED"].includes(generation.status)) {
      return NextResponse.json({ error: "Stop the active generation before deleting it." }, { status: 409 });
    }
    if (!MOCK_MODE) await deleteModalGeneration(id);
    const result = await prisma.generation.deleteMany({ where: { id } });
    return NextResponse.json({ success: true, deleted: result.count > 0 });
  } catch (error) {
    console.error("Delete generation failed", error);
    return NextResponse.json({ error: "Could not delete generation" }, { status: 500 });
  }
}
