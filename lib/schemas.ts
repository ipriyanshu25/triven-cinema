import { z } from "zod";

export const sceneSchema = z.object({
  order: z.number().int().min(1),
  title: z.string().min(1).max(100),
  prompt: z.string().min(10).max(2500),
  duration: z.number().int().min(2).max(15),
});

export const planSchema = z.object({
  prompt: z.string().min(5).max(8000),
  durationSeconds: z.number().int().min(5).max(60).default(20),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
});

const fpsSchema = z.union([
  z.literal(24),
  z.literal(25),
  z.literal(30),
  z.literal(48),
  z.literal(50),
]);

export const generationSchema = z.object({
  prompt: z.string().min(5).max(8000),
  mode: z.enum(["DIRECT", "SCENES"]),
  videoType: z.enum(["cartoon", "story", "cinematic", "product-ad", "explainer", "social"]).default("cinematic"),
  model: z.literal("ltx-2.5").default("ltx-2.5"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  quality: z.enum(["draft", "standard", "high", "ultra", "preview", "1080p"]),
  renderMode: z.enum(["fast", "pro"]).default("fast"),
  resolution: z.enum(["720p", "1080p", "1440p", "4k"]).default("1080p"),
  fps: fpsSchema.default(24),
  audioQuality: z.enum(["off", "standard", "high"]).default("standard"),
  durationSeconds: z.number().int().min(2).max(60),
  nativeAudio: z.boolean(),
  enhancePrompt: z.boolean(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  continuityContext: z.string().max(4000).optional(),
  scenes: z.array(sceneSchema).max(12).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === "SCENES" && (!value.scenes || value.scenes.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["scenes"], message: "Scene mode requires at least one scene." });
  }
});
