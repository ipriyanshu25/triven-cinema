import { Client } from "@gradio/client";

type GenerateArgs = {
  prompt: string;
  width?: number;
  height?: number;
  duration?: number;
  autoLength?: boolean;
  seed?: number;
  randomizeSeed?: boolean;
};

export async function generateWithChopperBlu(
  args: GenerateArgs
) {
  const spaceId =
    process.env.HF_SPACE_ID ||
    "ChopperBlu/ltx-2-5-demo";

  console.log("[HF] Connecting to:", spaceId);

  const client = await Client.connect(spaceId);

  console.log("[HF] Connected");

  //
  // STEP 1 - prepare prompt
  //
  const prepared = await client.predict(
    "/prepare_prompt",
    [
      args.prompt,

      // no input image
      null,

      // don't use enhancer for first test
      false,
    ]
  );

  console.log(
    "[HF] prepare_prompt result:",
    prepared.data
  );

  let preparedPrompt = args.prompt;

  if (
    Array.isArray(prepared.data) &&
    prepared.data.length > 0 &&
    prepared.data[0]
  ) {
    preparedPrompt = String(
      prepared.data[0]
    );
  }

  //
  // STEP 2 - LTX generation
  //
  console.log("[HF] Starting video generation");

  const generated = await client.predict(
    "/generate_video",
    [
      preparedPrompt,

      // optional image
      null,

      // dimensions
      args.width ?? 576,
      args.height ?? 1024,

      // duration
      args.duration ?? 2,

      // automatic duration
      args.autoLength ?? false,

      // seed
      args.seed ?? 42,

      // randomize seed
      args.randomizeSeed ?? true,

      //
      // IMPORTANT:
      // ChopperBlu expects:
      // "conv"
      // or
      // "diffusion"
      //
      "conv",
    ]
  );

  console.log(
    "[HF] generate_video result:",
    JSON.stringify(
      generated.data,
      null,
      2
    )
  );

  return {
    preparedPrompt,
    data: generated.data,
  };
}