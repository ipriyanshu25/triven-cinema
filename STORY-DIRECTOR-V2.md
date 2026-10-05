# Triven Cinema — Story Director v2

Story Director v2 fixes the failure mode where long prose is treated like one raw video prompt and unrelated cartoon imagery/text artifacts are generated.

## High Accuracy pipeline

For Story, Cartoon, and Devotional presets, High Accuracy is the default:

1. The complete source text is sent to a local open-weight Story Director (`Qwen/Qwen3-VL-4B-Instruct`) running on a Modal L4.
2. The Director returns a strict JSON production plan with the complete story arc, recurring character bible, world/style bible, scene beats, visible characters, narration metadata, dialogue metadata, and negative constraints.
3. Triven compiles only visual/action information into the LTX prompt. Long narration and dialogue are kept as metadata instead of being injected into the image prompt.
4. Strict continuity carries the final frame into the next compatible scene with `LTX2ImageToVideoPipeline`. It deliberately does not bridge across time jumps, departures, or cuts where a recurring character leaves the frame.
5. Each generated story scene is sampled into a three-frame contact sheet and reviewed by the same multimodal Story Supervisor for prompt adherence, character consistency, accidental text/subtitles, and unrelated subjects. When a previous scene exists, its final frame is supplied as a separate visual continuity reference so the reviewer can compare recurring character identity across scenes.
6. A scene that fails the semantic threshold is regenerated once with a concise positive correction, then reviewed again.
7. FFmpeg stitches the accepted clips and the existing technical QC/finalization path remains unchanged.

## Safety fallback

If the AI Director is unavailable, the deterministic fallback now reads/distributes the complete source instead of reusing only the first paragraph. It filters pronouns/place names out of the character list, separates narration from visual prompts, builds per-scene character locks, blocks accidental typography, and preserves previous-scene memory.

## One-time model cache

The existing LTX cache is unchanged. Story Director v2 adds one new open-weight model to the same Modal model-cache volume:

```bash
modal run modal/cinema.py::prefetch_director
```

Then deploy normally:

```bash
modal deploy modal/cinema.py
```

## Recommended first test

- Preset: Devotional
- Build: Scenes
- Memory: Strict
- Accuracy: High - AI Director
- Duration: 45 sec
- Mode: Fast
- Resolution: 1080p
- FPS: 24

Use 1080p/24 for the first semantic/continuity test. Move to 4K only after the scene plan and character continuity look correct.
