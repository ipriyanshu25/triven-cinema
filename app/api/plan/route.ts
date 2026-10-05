import { NextResponse } from "next/server";
import { compileDirectorPlan, planScenes } from "@/lib/scene-planner";
import { planModalStory } from "@/lib/modal";
import { planSchema } from "@/lib/schemas";

const MOCK_MODE = process.env.MOCK_MODE === "true";
const DIRECTOR_ENABLED = process.env.TRIVEN_STORY_DIRECTOR !== "false";

export async function POST(request: Request) {
  try {
    const input = planSchema.parse(await request.json());

    if (!MOCK_MODE && DIRECTOR_ENABLED && input.storyAccuracy === "high") {
      try {
        const director = await planModalStory(input);
        const plan = compileDirectorPlan(
          input.prompt,
          input.durationSeconds,
          input.aspectRatio,
          input.continuityMode,
          input.videoType,
          director,
        );
        return NextResponse.json(plan);
      } catch (error) {
        console.warn("AI Director planning failed; using deterministic full-story fallback", error);
      }
    }

    const plan = await planScenes(input.prompt, input.durationSeconds, input.aspectRatio, input.continuityMode, input.videoType);
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
