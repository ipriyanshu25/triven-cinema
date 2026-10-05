import { NextResponse } from "next/server";
import { cancelModalJob } from "@/lib/modal";
import { prisma } from "@/lib/prisma";

const MOCK_MODE = process.env.MOCK_MODE === "true";

const includeGeneration = {
  scenes: { orderBy: { order: "asc" as const } },
  versions: { orderBy: { createdAt: "desc" as const } },
};

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const generation = await prisma.generation.findUnique({ where: { id }, include: includeGeneration });
  if (!generation) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  if (["COMPLETED", "FAILED", "CANCELLED"].includes(generation.status)) return NextResponse.json(generation);

  try {
    if (MOCK_MODE) {
      const stopped = await prisma.generation.update({
        where: { id },
        data: { status: "CANCELLED", progress: 0, statusMessage: "Generation stopped by user", error: null },
        include: includeGeneration,
      });
      return NextResponse.json(stopped);
    }

    const remote = await cancelModalJob(id);
    const status = remote.status === "CANCELLED" ? "CANCELLED" : "CANCEL_REQUESTED";
    const stopped = await prisma.generation.update({
      where: { id },
      data: {
        status,
        progress: remote.progress ?? generation.progress,
        statusMessage: remote.message ?? (status === "CANCELLED" ? "Generation stopped by user" : "Stopping generation"),
        error: null,
      },
      include: includeGeneration,
    });

    return NextResponse.json(stopped);
  } catch (error) {
    console.error("Cancel generation failed", error);
    return NextResponse.json({ error: "Could not stop generation" }, { status: 502 });
  }
}
