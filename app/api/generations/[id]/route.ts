import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getModalJob } from "@/lib/modal";

const MOCK_MODE = process.env.MOCK_MODE === "true";
const modalToDb: Record<string, "QUEUED" | "GENERATING" | "STITCHING" | "UPLOADING" | "COMPLETED" | "FAILED"> = {
  QUEUED: "QUEUED", GENERATING: "GENERATING", STITCHING: "STITCHING", UPLOADING: "UPLOADING", COMPLETED: "COMPLETED", FAILED: "FAILED",
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let generation = await prisma.generation.findUnique({ where: { id }, include: { scenes: { orderBy: { order: "asc" } } } });
  if (!generation) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  if (!MOCK_MODE && !["COMPLETED", "FAILED"].includes(generation.status)) {
    try {
      const remote = await getModalJob(id);
      generation = await prisma.generation.update({
        where: { id },
        data: {
          status: modalToDb[remote.status] || generation.status,
          progress: remote.progress ?? generation.progress,
          statusMessage: remote.message ?? generation.statusMessage,
          outputUrl: remote.outputUrl ?? generation.outputUrl,
          gpuSeconds: remote.gpuSeconds ?? generation.gpuSeconds,
          actualCost: remote.actualCost ?? generation.actualCost,
          error: remote.error ?? generation.error,
        },
        include: { scenes: { orderBy: { order: "asc" } } },
      });
    } catch (error) {
      console.error("Modal status sync failed", error);
    }
  }

  return NextResponse.json(generation);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await prisma.generation.deleteMany({ where: { id } });
    return NextResponse.json({ success: true, deleted: result.count > 0 });
  } catch (error) {
    console.error("Delete generation failed", error);
    return NextResponse.json({ error: "Could not delete generation" }, { status: 500 });
  }
}
