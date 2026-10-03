import { NextResponse } from "next/server";
import { planScenes } from "@/lib/scene-planner";
import { planSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    const input = planSchema.parse(await request.json());
    const plan = await planScenes(input.prompt, input.durationSeconds, input.aspectRatio);
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
