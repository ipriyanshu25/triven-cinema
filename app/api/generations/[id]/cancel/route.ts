import { NextResponse } from "next/server";
import { cancelModalJob } from "@/lib/modal";
import { prisma } from "@/lib/prisma";

const MOCK_MODE = process.env.MOCK_MODE === "true";
const STOPPED_MESSAGE = "Generation stopped by user";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: { scenes: { orderBy: { order: "asc" } } },
  });

  if (!generation) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  if (["COMPLETED", "FAILED"].includes(generation.status)) {
    return NextResponse.json(generation);
  }

  try {
    if (!MOCK_MODE) await cancelModalJob(id);

    const stopped = await prisma.generation.update({
      where: { id },
      data: {
        status: "FAILED",
        statusMessage: STOPPED_MESSAGE,
        error: null,
      },
      include: { scenes: { orderBy: { order: "asc" } } },
    });

    return NextResponse.json(stopped);
  } catch (error) {
    console.error("Cancel generation failed", error);
    return NextResponse.json({ error: "Could not stop generation" }, { status: 502 });
  }
}
