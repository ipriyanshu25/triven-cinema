import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteModalEditVersion, getModalEdit } from "@/lib/modal";

const MOCK_MODE = process.env.MOCK_MODE === "true";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  let version = await prisma.videoVersion.findFirst({ where: { id: versionId, generationId: id } });
  if (!version) return NextResponse.json({ error: "Edit version not found" }, { status: 404 });

  if (!MOCK_MODE && !["COMPLETED", "FAILED"].includes(version.status)) {
    try {
      const remote = await getModalEdit(versionId);
      version = await prisma.videoVersion.update({
        where: { id: versionId },
        data: {
          status: remote.status,
          outputUrl: remote.outputUrl ?? version.outputUrl,
          thumbnailUrl: remote.thumbnailUrl ?? version.thumbnailUrl,
          qcReport: remote.qcReport ? remote.qcReport as Prisma.InputJsonValue : undefined,
          error: remote.error ?? version.error,
        },
      });
    } catch (error) {
      console.error("Modal edit status sync failed", error);
    }
  }

  return NextResponse.json(version);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const version = await prisma.videoVersion.findFirst({ where: { id: versionId, generationId: id } });
  if (!version) return NextResponse.json({ success: true, deleted: false });
  if (["QUEUED", "PROCESSING"].includes(version.status)) {
    return NextResponse.json({ error: "Wait for this edit to finish before deleting it." }, { status: 409 });
  }
  try {
    if (!MOCK_MODE) await deleteModalEditVersion(id, versionId);
    await prisma.videoVersion.delete({ where: { id: versionId } });
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("Edit version delete failed", error);
    return NextResponse.json({ error: "Could not delete this edit version" }, { status: 500 });
  }
}
