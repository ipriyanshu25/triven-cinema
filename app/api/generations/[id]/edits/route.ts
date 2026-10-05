import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { editRequestSchema } from "@/lib/schemas";
import { submitModalEdit } from "@/lib/modal";

const MOCK_MODE = process.env.MOCK_MODE === "true";
const MAX_ACTIVE_EDITS = Math.max(1, Number(process.env.TRIVEN_MAX_ACTIVE_EDITS || 4));
const MAX_VERSIONS_PER_GENERATION = Math.max(1, Number(process.env.TRIVEN_MAX_VERSIONS_PER_GENERATION || 20));

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const versions = await prisma.videoVersion.findMany({ where: { generationId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(versions);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const input = editRequestSchema.parse(await request.json());
    const generation = await prisma.generation.findUnique({ where: { id } });
    if (!generation) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    if (generation.status !== "COMPLETED" || !generation.outputUrl) {
      return NextResponse.json({ error: "The source video must be completed before editing." }, { status: 409 });
    }

    if (!MOCK_MODE) {
      const [activeEdits, versionCount] = await Promise.all([
        prisma.videoVersion.count({ where: { status: { in: ["QUEUED", "PROCESSING"] } } }),
        prisma.videoVersion.count({ where: { generationId: id } }),
      ]);
      if (activeEdits >= MAX_ACTIVE_EDITS) {
        return NextResponse.json({ error: `Editor capacity is busy (${activeEdits}/${MAX_ACTIVE_EDITS}). Wait for an active edit to finish.` }, { status: 429 });
      }
      if (versionCount >= MAX_VERSIONS_PER_GENERATION) {
        return NextResponse.json({ error: `This video already has ${versionCount} edited versions. Delete or archive older versions before creating more.` }, { status: 409 });
      }
    }

    const version = await prisma.videoVersion.create({
      data: {
        generationId: id,
        label: input.label,
        status: MOCK_MODE ? "COMPLETED" : "QUEUED",
        outputUrl: MOCK_MODE ? generation.outputUrl : null,
        operations: input.operations as Prisma.InputJsonValue,
      },
    });

    if (MOCK_MODE) return NextResponse.json(version, { status: 201 });

    try {
      const job = await submitModalEdit({
        generationId: id,
        versionId: version.id,
        sourceUrl: generation.outputUrl,
        operations: input.operations,
      });
      const updated = await prisma.videoVersion.update({
        where: { id: version.id },
        data: { providerJobId: job.callId },
      });
      return NextResponse.json(updated, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start video edit";
      const failed = await prisma.videoVersion.update({
        where: { id: version.id },
        data: { status: "FAILED", error: message },
      });
      return NextResponse.json(failed, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid edit request" }, { status: 400 });
  }
}
