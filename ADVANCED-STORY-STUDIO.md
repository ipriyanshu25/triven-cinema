# Triven Cinema — Advanced Story Studio

This upgrade adds a scene-first creation workflow on top of the production foundation.

## What is implemented

- Quick creation formats: Reel / Short, Story Film, Cartoon, Devotional, Cinematic, Product Ad, Explainer.
- Explicit Build mode: Auto, Single shot, Scenes.
- Scene continuity modes:
  - Strict — carries the previous rendered frame into the next scene through LTX image-to-video and repeats the immutable character/world memory.
  - Balanced — uses the previous-frame bridge only when the director marks the next scene as continuous.
  - Creative — scene prompts share the story bible, but visual frame bridging is disabled.
- Scene Studio before generation:
  - plan scenes from a master prompt;
  - edit title, duration and scene prompt;
  - reorder, add and remove scenes;
  - inspect character lock, world lock and previous-scene memory.
- Director memory per scene:
  - immutable character descriptors;
  - world/style descriptors;
  - previous-scene state summary;
  - carry-forward constraints;
  - allowed changes for the current scene.
- LTX continuity bridge:
  - extracts the final frame of a rendered scene;
  - reuses it as image conditioning for the next compatible scene;
  - shares the loaded LTX components with `LTX2ImageToVideoPipeline` rather than loading a second copy of the model weights.

## Why this helps

Text-only generation cannot guarantee identical characters across separately sampled clips. The Story Studio now combines semantic memory in every scene prompt with visual continuity from the previous rendered frame. Story, Cartoon, and Devotional default to Strict memory and High Accuracy; other formats default to Balanced memory.

## Next production layer

For still stronger cross-location identity consistency, add user-uploaded character references and an Ingredients/reference-sheet IC-LoRA workflow behind a feature flag. Add pose/depth/motion controls only through workflows validated for the deployed LTX version. For transcript-perfect dialogue, use a dedicated TTS/dialogue track and a validated lip-sync/dubbing workflow rather than relying on native generative speech alone.


## Story Director v2

High Accuracy now uses a local multimodal Story Director before generation and a semantic visual reviewer after each story scene. See `STORY-DIRECTOR-V2.md` for the full pipeline and one-time Director model cache command.
