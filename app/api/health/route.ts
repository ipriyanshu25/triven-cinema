import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getModalHealth } from "@/lib/modal";

const MOCK_MODE = process.env.MOCK_MODE === "true";

export async function GET() {
  const checkedAt = new Date().toISOString();
  let database = false;
  let modal: "ok" | "skipped" | "error" = MOCK_MODE ? "skipped" : "error";
  let modalDetail: unknown = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch (error) {
    console.error("Health check database failure", error);
  }

  if (!MOCK_MODE) {
    try {
      modalDetail = await getModalHealth();
      modal = "ok";
    } catch (error) {
      modalDetail = error instanceof Error ? error.message : "Modal health check failed";
      console.error("Health check Modal failure", error);
    }
  }

  const ok = database && (MOCK_MODE || modal === "ok");
  return NextResponse.json(
    {
      ok,
      checkedAt,
      mode: MOCK_MODE ? "mock" : "modal",
      database: database ? "ok" : "error",
      modal,
      modalDetail,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
