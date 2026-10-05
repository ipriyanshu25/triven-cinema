import type {
  CharacterBibleEntry,
  ContinuityMode,
  ProductionBrief,
  ScenePlan,
  ScenePlanItem,
  StoryArc,
  VideoType,
} from "@/lib/types";

const MAX_SCENES = 30;
const MAX_SCENE_SECONDS = 20;

export const STORY_NEGATIVE_PROMPT = [
  "visible text",
  "subtitles",
  "captions",
  "letters",
  "words",
  "typography",
  "watermark",
  "logo",
  "UI",
  "speech bubbles",
  "random signage",
  "unrelated characters",
  "duplicate people",
  "extra limbs",
  "malformed hands",
  "deformed faces",
  "identity drift",
  "wardrobe changes",
  "flicker",
  "frame tearing",
].join(", ");

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\\\s*\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function oneLine(value: string): string {
  return normalizeWhitespace(value).replace(/\n+/g, " ").trim();
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => oneLine(item)).filter(Boolean))];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? oneLine(value) : fallback;
}

function asStringArray(value: unknown, max = 20): string[] {
  return Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === "string")).slice(0, max) : [];
}

function extractSection(prompt: string, heading: string, nextHeadings: string[] = []): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = nextHeadings.length
    ? nextHeadings.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
    : "SCENE\\s+\\d+";
  const pattern = new RegExp(
    `(?:^|\\n)#{0,4}\\s*${escaped}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n#{0,4}\\s*(?:${next})\\s*:?\\s*\\n|\\n#{0,4}\\s*SCENE\\s+\\d+|$)`,
    "i",
  );
  return normalizeWhitespace(prompt.match(pattern)?.[1] || "");
}

function extractInline(prompt: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = prompt.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${escaped}\\s*:\\s*([^\\n]+)`, "i"));
    if (match?.[1]) return oneLine(match[1]);
  }
  return "";
}

function extractBullets(section: string): string[] {
  if (!section) return [];
  const lines = section
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^(?:main character|characters?|setting|audio|camera|rules?)\s*:?$/i.test(line));
  return unique(lines.length > 1 ? lines : section.split(/[.;]\s+/)).filter((line) => !/^(?:main character|characters?|setting|audio|camera|rules?)\s*:?$/i.test(line));
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split("\n").map((line) => line.trim()).find(Boolean) || "";
  if (firstLine.length >= 3 && firstLine.length <= 100 && !/[.!?]$/.test(firstLine)) return firstLine.replace(/^#+\s*/, "");
  const heading = prompt.match(/^\s*#{1,4}\s*([^\n#]{3,100})/m)?.[1];
  if (heading && !/^scene\s+\d+/i.test(heading)) return oneLine(heading).slice(0, 100);
  return oneLine(prompt).split(/[.!?]/)[0].slice(0, 100) || "Untitled video";
}

function namedCharacters(prompt: string): string[] {
  // Capitalized-word extraction is intentionally conservative. Long-form prose often starts
  // sentences with pronouns/places ("She", "They", "Vrindavan") that are not characters.
  const stop = new Set([
    "When", "Long", "The", "Every", "One", "And", "But", "From", "Years", "Some", "Perhaps", "Nothing", "Then", "Because", "Inside", "Outside",
    "Scene", "Visual", "Audio", "Camera", "She", "He", "They", "Them", "Her", "His", "Their", "It", "Its", "We", "You", "I", "There", "Here",
    "This", "That", "These", "Those", "A", "An", "If", "As", "At", "On", "In", "To", "Of", "For", "With", "Without", "Before", "After",
    "Vrindavan", "Yamuna", "Govardhan", "India", "Moon", "River", "Forest", "Flute", "Kadamba",
  ]);
  const known = [...prompt.matchAll(/\b([A-Z][a-z]{2,})(?:['’]s)?\b/g)]
    .map((match) => match[1])
    .filter((name) => !stop.has(name));
  const frequency = new Map<string, number>();
  for (const name of known) frequency.set(name, (frequency.get(name) || 0) + 1);
  return [...frequency.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 8);
}

function inferNaturalCharacters(prompt: string): string[] {
  const names = namedCharacters(prompt);
  if (names.length) return names;
  const candidates = prompt
    .split(/(?<=[.!?])\s+|\n+/)
    .map(oneLine)
    .filter((line) => line.length >= 12 && line.length <= 700)
    .filter((line) => /\b(?:girl|boy|woman|man|child|children|kid|kids|person|people|character|hero|heroine|guide|teacher|family|couple|baby|fox|dog|cat|bird|animal|robot|creature|princess|prince|king|queen|knight|explorer|adventurer)\b/i.test(line));
  return unique(candidates).slice(0, 6);
}

function detectIntent(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/radha|krishna|vrindavan|devotional|bhakti|divine love|mythological|spiritual/.test(lower)) return "Tell a reverent devotional story with emotional clarity, restrained sacred imagery, and faithful recurring-character continuity.";
  if (/product\s+(?:ad|advert|commercial)|brand\s+film|ugc\s+ad/.test(lower)) return "Sell or demonstrate a product with a clear visual benefit and call-to-action.";
  if (/explainer|tutorial|how\s+to|educational/.test(lower)) return "Explain a concept clearly with visible cause-and-effect and easy-to-follow sequencing.";
  if (/story|narrative|episode|adventure|character/.test(lower)) return "Tell a coherent visual story with setup, development, emotional turning point, resolution, and recurring-character continuity.";
  if (/reel|tiktok|shorts?|social/.test(lower)) return "Create a fast, high-retention social video with an immediate hook and readable visual beats.";
  return "Create a polished cinematic video that follows the requested subject, action, style, and pacing.";
}

function defaultVisualStyle(prompt: string): string {
  if (/radha|krishna|vrindavan|devotional|bhakti|mythological/i.test(prompt)) {
    return "Premium stylized devotional cartoon animation with expressive but respectful character acting, warm painterly colors, soft volumetric sunset and moonlight, elegant Indian pastoral environments, cinematic depth, and stable feature-animation character design.";
  }
  if (/cartoon|animated|animation/i.test(prompt)) return "Premium stylized feature-animation look with stable character design, expressive faces, coherent materials, cinematic lighting, and natural motion.";
  return "Cinematic high-fidelity visual treatment with controlled lighting, coherent materials, natural motion, and stable subject identity.";
}

function defaultCharacterBible(prompt: string, names: string[]): CharacterBibleEntry[] {
  const lower = prompt.toLowerCase();
  return names.map((name) => {
    if (name.toLowerCase() === "krishna") {
      return {
        name,
        role: "central recurring character",
        appearance: "A youthful boy with dark curls, gentle expressive eyes, a calm warm smile, and a peacock feather resting in his hair.",
        wardrobe: "The same yellow traditional clothing in every scene, with the same flute kept as his signature prop.",
        voice: "Soft, calm, reassuring youthful voice.",
        immutableTraits: ["dark curls", "peacock feather", "yellow clothing", "flute", "gentle smile", "same face and proportions"],
      };
    }
    if (name.toLowerCase() === "radha") {
      return {
        name,
        role: "central recurring character",
        appearance: "A young girl with long dark hair, large gentle expressive eyes, graceful features, and a peaceful devotional presence.",
        wardrobe: "The same elegant traditional Vrindavan outfit and jewelry across connected scenes unless the story explicitly advances time.",
        voice: "Soft, sincere youthful voice.",
        immutableTraits: ["long dark hair", "gentle eyes", "traditional Vrindavan clothing", "same face and proportions", "graceful expression"],
      };
    }
    return {
      name,
      role: "recurring character",
      appearance: `Keep ${name}'s face, age, hair, body proportions, colors, and distinguishing features identical throughout the video.`,
      wardrobe: `Keep ${name}'s established wardrobe and accessories unchanged between connected scenes.`,
      immutableTraits: ["same face", "same age", "same hair", "same body proportions", "same wardrobe"],
    };
  }).filter((entry) => !/^(?:Yamuna|Govardhan|Vrindavan)$/i.test(entry.name));
}

function buildProductionBrief(prompt: string): ProductionBrief {
  const visualStyle = oneLine(
    extractSection(prompt, "Visual Style", ["Main Character", "Characters", "Setting", "Audio", "Camera & Animation", "Camera", "Important Generation Rules", "Rules"])
      || extractInline(prompt, ["Style", "Visual style", "Look"])
      || defaultVisualStyle(prompt),
  );
  const mainCharacterSection = extractSection(prompt, "Main Character", ["Characters", "Setting", "Audio", "Camera & Animation", "Camera", "Important Generation Rules", "Rules"]);
  const supportingCharacterSection = extractSection(prompt, "Characters", ["Setting", "Audio", "Camera & Animation", "Camera", "Important Generation Rules", "Rules"]);
  const characterSection = [mainCharacterSection, supportingCharacterSection].filter(Boolean).join("\n") || extractInline(prompt, ["Character", "Characters", "Subject"]);
  const settingSection = extractSection(prompt, "Setting", ["Audio", "Camera & Animation", "Camera", "Important Generation Rules", "Rules"]) || extractInline(prompt, ["Setting", "Location", "Environment"]);
  const cameraLanguage = oneLine(extractSection(prompt, "Camera & Animation", ["Important Generation Rules", "Rules", "Audio"]) || extractSection(prompt, "Camera", ["Important Generation Rules", "Rules", "Audio"]) || extractInline(prompt, ["Camera", "Camera movement"]) || "Use motivated cinematic framing, stable geometry, gentle subject-led camera movement, and clear visual storytelling.");
  const audioDirection = oneLine(extractSection(prompt, "Audio", ["Camera & Animation", "Camera", "Important Generation Rules", "Rules"]) || extractInline(prompt, ["Audio", "Sound", "Music"]) || (/flute|vrindavan|krishna/i.test(prompt) ? "Use soft flute motifs, natural forest ambience, Yamuna water, distant birds and peacocks, and restrained devotional scoring." : "Use synchronized ambience and scene-appropriate sound design."));
  const rules = extractSection(prompt, "Important Generation Rules", ["Audio", "Camera & Animation", "Camera"]) || extractSection(prompt, "Rules", ["Audio", "Camera & Animation", "Camera"]);
  const mustHave = extractBullets(rules).filter((item) => !/avoid|do not|don't|never|no\s/i.test(item)).slice(0, 20);
  const avoid = unique([
    ...extractBullets(rules).filter((item) => /avoid|do not|don't|never|no\s/i.test(item)),
    "No visible text, subtitles, captions, letters, logos, watermarks, or prompt fragments inside generated frames.",
    "No unrelated characters or random crowd substitutions.",
  ]).slice(0, 20);
  const explicitCharacters = extractBullets(characterSection).slice(0, 20);
  const characters = explicitCharacters.length ? explicitCharacters : inferNaturalCharacters(prompt);
  const bible = defaultCharacterBible(prompt, characters.map((item) => item.split(/[:—-]/)[0].trim()));
  const locations = extractBullets(settingSection).slice(0, 20);
  if (!locations.length) {
    if (/vrindavan/i.test(prompt)) locations.push("Vrindavan forest with flowering vines and kadamba trees");
    if (/yamuna/i.test(prompt)) locations.push("The Yamuna riverbank");
    if (/govardhan/i.test(prompt)) locations.push("Distant Govardhan beneath sunset or moonlight");
  }
  const warnings: string[] = [
    "Generated typography is disabled for story scenes because video models often hallucinate letters and subtitle-like artifacts.",
    "Exact spoken wording is not guaranteed by native generative audio; narration and dialogue are kept separate from the visual prompt.",
  ];
  if (/consistent|same character|identical|radha|krishna/i.test(prompt)) warnings.push("Strict scene mode uses both a character bible and previous-frame image conditioning to reduce identity drift.");

  const characterLock = bible.length
    ? bible.map((entry) => `${entry.name}: ${entry.appearance} ${entry.wardrobe || ""} Immutable details: ${entry.immutableTraits.join(", ")}.`).join(" ")
    : characters.join(" | ");
  const continuity = oneLine(`Preserve recurring identities and world design across connected scenes. ${characterLock} ${visualStyle} ${locations.join(" ")}`).slice(0, 5600);

  return {
    title: titleFromPrompt(prompt),
    source: "deterministic",
    intent: detectIntent(prompt),
    visualStyle,
    characters,
    locations,
    cameraLanguage,
    audioDirection,
    mustHave,
    avoid,
    continuity,
    warnings,
    characterBible: bible,
  };
}

function parseClock(value: string): number | null {
  const clean = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  const parts = clean.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function findLabel(block: string, labels: string[]): string {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${escapedLabels})\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:VISUAL|ACTION|CAMERA|SHOT|AUDIO|SOUND|DIALOGUE|VOICE|NARRATION|TRANSITION|MUST HAVE|MUST-HAVE|TIME|DURATION|NOTES?)\\s*:|$)`, "i");
  return normalizeWhitespace(block.match(re)?.[1] || "");
}

function sceneCharacterNames(scene: Partial<ScenePlanItem>, brief: ProductionBrief): string[] {
  if (scene.charactersPresent?.length) return unique(scene.charactersPresent);
  const haystack = `${scene.storyBeat || ""} ${scene.sourceExcerpt || ""} ${scene.visual || ""} ${scene.action || ""}`;
  const lower = haystack.toLowerCase();
  const bible = brief.characterBible || [];
  const matches = bible.filter((entry) => {
    const namePattern = new RegExp(`\\b${entry.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");
    if (namePattern.test(haystack)) return true;
    if (entry.name.toLowerCase() === "krishna") return /boy dressed in yellow|peacock feather|dark curls/.test(lower);
    const traitTokens = unique(entry.immutableTraits
      .flatMap((trait) => trait.toLowerCase().split(/[^a-z0-9]+/))
      .filter((token) => token.length >= 5 && !["proportions", "clothing", "wardrobe"].includes(token)));
    const hits = traitTokens.filter((token) => lower.includes(token)).length;
    return hits >= 2;
  }).map((entry) => entry.name);
  if (!matches.length && bible.length === 1 && /\\b(?:he|she|his|her|they|their|them)\\b/i.test(haystack)) return [bible[0].name];
  return unique(matches);
}

function characterLockForScene(scene: Partial<ScenePlanItem>, brief: ProductionBrief): string {
  const names = new Set(sceneCharacterNames(scene, brief).map((name) => name.toLowerCase()));
  const entries = (brief.characterBible || []).filter((entry) => !names.size || names.has(entry.name.toLowerCase()));
  return oneLine(entries.map((entry) => `${entry.name}: ${entry.appearance} ${entry.wardrobe || ""} Immutable details: ${entry.immutableTraits.join(", ")}.`).join(" ")).slice(0, 1800);
}

function absentCharacterNegative(scene: Partial<ScenePlanItem>, brief: ProductionBrief): string {
  const present = new Set(sceneCharacterNames(scene, brief).map((name) => name.toLowerCase()));
  if (!present.size) return "";
  const absent = (brief.characterBible || []).map((entry) => entry.name).filter((name) => !present.has(name.toLowerCase()));
  return absent.length ? `do not show absent recurring characters: ${absent.join(", ")}` : "";
}

function naturalScenePrompt(scene: Partial<ScenePlanItem>, brief: ProductionBrief, memoryText = ""): string {
  const sceneNames = sceneCharacterNames(scene, brief);
  const characters = sceneNames.length ? `Recurring named characters visible in this shot: ${sceneNames.join(", ")}. Do not substitute their identities.` : "";
  // Dialogue/narration are intentionally NOT copied into the visual prompt. LTX can hallucinate
  // prompt words as subtitles/signage when long literary text is mixed into image instructions.
  return oneLine([
    scene.visual || scene.action || scene.storyBeat || scene.prompt || "Show one clear chronological story beat.",
    scene.action && scene.visual && oneLine(scene.action) !== oneLine(scene.visual) ? scene.action : "",
    characters,
    memoryText,
    brief.visualStyle,
    scene.camera || brief.cameraLanguage,
    scene.audio || brief.audioDirection,
  ].filter(Boolean).join(" ")).slice(0, 4900);
}

function parseSceneBlocks(prompt: string, productionBrief: ProductionBrief): ScenePlanItem[] {
  const normalized = prompt.replace(/\r/g, "");
  const header = /(?:^|\n)\s*#{0,4}\s*SCENE\s+(\d+)\s*(?:[—–:-]\s*([^\n]*))?\s*\n/gi;
  const matches = [...normalized.matchAll(header)];
  if (!matches.length) return [];
  const scenes: ScenePlanItem[] = [];
  for (let i = 0; i < Math.min(matches.length, MAX_SCENES); i += 1) {
    const match = matches[i];
    const order = Number(match[1]) || i + 1;
    const headerText = oneLine(match[2] || "");
    const bodyStart = (match.index || 0) + match[0].length;
    const bodyEnd = i + 1 < matches.length ? (matches[i + 1].index || normalized.length) : normalized.length;
    const block = normalized.slice(bodyStart, bodyEnd).trim();
    const timeText = findLabel(block, ["TIME", "TIMECODE"]);
    const durationText = findLabel(block, ["DURATION", "LENGTH"]);
    let duration: number | null = null;
    const range = timeText.match(/([0-9:.]+)\s*[—–-]\s*([0-9:.]+)/);
    if (range) {
      const start = parseClock(range[1]);
      const end = parseClock(range[2]);
      if (start != null && end != null && end > start) duration = end - start;
    }
    if (duration == null && durationText) {
      const d = durationText.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)?/i);
      if (d) duration = Number(d[1]);
    }
    const visual = findLabel(block, ["VISUAL", "VISUALS", "LOOK"]);
    const action = findLabel(block, ["ACTION", "BEAT", "STORY"]);
    const camera = findLabel(block, ["CAMERA", "SHOT", "CAMERA & ANIMATION"]);
    const audio = findLabel(block, ["AUDIO", "SOUND", "SFX", "MUSIC"]);
    const dialogue = findLabel(block, ["DIALOGUE", "VOICE", "VOICEOVER", "VO"]);
    const narration = findLabel(block, ["NARRATION", "NARRATOR"]);
    const transition = findLabel(block, ["TRANSITION"]);
    const mustHaveRaw = findLabel(block, ["MUST HAVE", "MUST-HAVE"]);
    const stripped = normalizeWhitespace(block.replace(/(?:^|\n)\s*(?:[-*]\s*)?(?:TIME|TIMECODE|DURATION|LENGTH|VISUALS?|LOOK|ACTION|BEAT|STORY|CAMERA(?:\s*&\s*ANIMATION)?|SHOT|AUDIO|SOUND|SFX|MUSIC|DIALOGUE|VOICEOVER|VOICE|VO|NARRATION|NARRATOR|TRANSITION|MUST HAVE|MUST-HAVE|NOTES?)\s*:\s*[^\n]*(?:\n(?!\s*(?:[-*]\s*)?(?:TIME|TIMECODE|DURATION|LENGTH|VISUALS?|LOOK|ACTION|BEAT|STORY|CAMERA(?:\s*&\s*ANIMATION)?|SHOT|AUDIO|SOUND|SFX|MUSIC|DIALOGUE|VOICEOVER|VOICE|VO|NARRATION|NARRATOR|TRANSITION|MUST HAVE|MUST-HAVE|NOTES?)\s*:)[^\n]*)*/gi, "\n"));
    const title = headerText.replace(/^\d+\s*[—–-]\s*\d+\s*seconds?\s*/i, "").replace(/^\d+\s*[—–-]\s*\d+\s*/i, "").trim() || `Scene ${order}`;
    const scene: ScenePlanItem = {
      order,
      title: title.slice(0, 120),
      duration: Math.max(2, Math.min(MAX_SCENE_SECONDS, Math.round(duration || 6))),
      prompt: "",
      visual: visual || stripped || undefined,
      action: action || stripped || undefined,
      camera: camera || undefined,
      audio: audio || undefined,
      dialogue: dialogue || undefined,
      narration: narration || undefined,
      transition: transition || undefined,
      mustHave: extractBullets(mustHaveRaw).slice(0, 20),
      negativePrompt: STORY_NEGATIVE_PROMPT,
    };
    scene.prompt = naturalScenePrompt(scene, productionBrief);
    scenes.push(scene);
  }
  return scenes;
}

function storySentences(prompt: string): string[] {
  return normalizeWhitespace(prompt)
    .replace(/^[^\n]{3,100}\n+/, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => oneLine(item.replace(/^[-*•]\s*/, "")))
    .filter((item) => item.length >= 8)
    .filter((item) => !/^(?:duration|style|resolution|fps|aspect ratio|video type)\s*:/i.test(item));
}

function distributedStoryBeats(prompt: string, sceneCount: number): { beat: string; excerpt: string }[] {
  const sentences = storySentences(prompt);
  if (!sentences.length) return Array.from({ length: sceneCount }, (_, i) => ({ beat: `Advance story beat ${i + 1} clearly and chronologically.`, excerpt: "" }));
  const beats: { beat: string; excerpt: string }[] = [];
  for (let i = 0; i < sceneCount; i += 1) {
    const start = Math.floor((i * sentences.length) / sceneCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * sentences.length) / sceneCount));
    const chunk = sentences.slice(start, end);
    const excerpt = oneLine(chunk.join(" ")).slice(0, 1100);
    const beat = oneLine(chunk.length <= 2 ? chunk.join(" ") : `${chunk[0]} ${chunk.at(-1)}`).slice(0, 700);
    beats.push({ beat, excerpt });
  }
  return beats;
}

function normalizeDurations(count: number, durationSeconds: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(count * 2, durationSeconds);
  const base = Math.floor(safeTotal / count);
  let extra = safeTotal - base * count;
  return Array.from({ length: count }, () => {
    const value = base + (extra > 0 ? 1 : 0);
    extra -= extra > 0 ? 1 : 0;
    return Math.max(2, Math.min(MAX_SCENE_SECONDS, value));
  });
}

function memoryLocks(productionBrief: ProductionBrief) {
  const characterLock = oneLine(
    productionBrief.characterBible?.length
      ? productionBrief.characterBible.map((entry) => `${entry.name}: ${entry.appearance} ${entry.wardrobe || ""} ${entry.immutableTraits.join(", ")}.`).join(" ")
      : productionBrief.characters.length ? productionBrief.characters.join(" | ") : productionBrief.continuity,
  ).slice(0, 1800);
  const worldLock = oneLine([
    productionBrief.visualStyle,
    productionBrief.locations.length ? `The recurring world includes ${productionBrief.locations.join("; ")}.` : "",
    productionBrief.cameraLanguage,
  ].filter(Boolean).join(" ")).slice(0, 1800);
  return { characterLock, worldLock };
}

function applySceneMemory(scenes: ScenePlanItem[], productionBrief: ProductionBrief, continuityMode: ContinuityMode): ScenePlanItem[] {
  const { worldLock } = memoryLocks(productionBrief);
  let previousSceneSummary = "";
  let previousCharacters: string[] = [];
  return scenes.map((scene, index) => {
    let currentCharacters = sceneCharacterNames(scene, productionBrief);
    const transitionText = `${scene.transition || ""} ${scene.storyBeat || ""} ${scene.sourceExcerpt || ""} ${scene.action || ""} ${scene.prompt || ""}`.toLowerCase();
    const timeOrRealityReset = /flashback|dream sequence|different protagonist|identity change|years? passed|months? passed|days? later|time jump|after many years|had to leave|has to leave|must leave|departs?|walks away|left vrindavan|departure|farewell|goodbye|alone beneath|alone under/.test(transitionText);
    if (index > 0 && !timeOrRealityReset && /\b(?:they|their|them|both|together)\b/.test(transitionText)) {
      currentCharacters = unique([...previousCharacters, ...currentCharacters]);
    }
    const sceneCharacterLock = characterLockForScene({ ...scene, charactersPresent: currentCharacters }, productionBrief);
    const removedCharacter = previousCharacters.some((name) => !currentCharacters.some((current) => current.toLowerCase() === name.toLowerCase()));
    const sharesCharacter = currentCharacters.length === 0 || previousCharacters.length === 0 || currentCharacters.some((name) => previousCharacters.some((previous) => previous.toLowerCase() === name.toLowerCase()));
    // Previous-frame I2V is powerful, but it is harmful across time jumps or when a character
    // intentionally leaves the scene. Skip the visual bridge there and rely on the character bible.
    const bridgeFromPrevious = index > 0 && !timeOrRealityReset && !removedCharacter && sharesCharacter && continuityMode !== "creative";
    const carryForward = unique([
      ...productionBrief.mustHave,
      ...(scene.mustHave || []),
      "Visible recurring characters retain the same face, age, hair, body proportions, wardrobe, accessories and signature props.",
    ]).slice(0, 20);
    const visibleEntries = (productionBrief.characterBible || []).filter((entry) => currentCharacters.length === 0 || currentCharacters.some((name) => name.toLowerCase() === entry.name.toLowerCase()));
    const identityAnchors = unique(visibleEntries.flatMap((entry) => [entry.name, ...entry.immutableTraits])).slice(0, 30);
    const memory = {
      characterLock: sceneCharacterLock,
      worldLock,
      previousSceneSummary: previousSceneSummary || undefined,
      carryForward,
      allowedChanges: unique([scene.action || scene.storyBeat || "Only the requested pose, expression, action, framing and location progression may change.", scene.transition || ""]).slice(0, 12),
      bridgeFromPrevious,
      identityAnchors,
    };
    const memoryText = oneLine([
      sceneCharacterLock ? `Keep the visible recurring characters exactly on-model: ${sceneCharacterLock}` : "",
      worldLock ? `The same visual world and art direction continue: ${worldLock}` : "",
      previousSceneSummary ? `Story continuity: this moment follows ${previousSceneSummary}` : "",
      bridgeFromPrevious ? "Begin from the previous scene's visual state, then progress the new action naturally." : "",
    ].filter(Boolean).join(" "));
    const compiledPrompt = naturalScenePrompt({ ...scene, charactersPresent: currentCharacters }, productionBrief, memoryText);
    const absentNegative = absentCharacterNegative({ ...scene, charactersPresent: currentCharacters }, productionBrief);
    previousSceneSummary = oneLine(`${scene.title}. ${scene.action || scene.storyBeat || scene.visual || compiledPrompt}`).slice(0, 1000);
    previousCharacters = currentCharacters;
    return {
      ...scene,
      charactersPresent: currentCharacters,
      prompt: compiledPrompt,
      negativePrompt: oneLine(`${STORY_NEGATIVE_PROMPT}, ${absentNegative}, ${scene.negativePrompt || ""}, ${productionBrief.avoid.join(", ")}`).slice(0, 2400),
      memory,
    };
  });
}

function deterministicPlan(prompt: string, durationSeconds: number, continuityMode: ContinuityMode, videoType: VideoType): ScenePlan {
  const productionBrief = buildProductionBrief(prompt);
  if (videoType === "social") productionBrief.intent = "Create a high-retention social story with an immediate hook, rapid readable beats, and a clear payoff.";
  if (videoType === "cartoon") productionBrief.intent = "Tell a visually clear animated story with stable character designs, readable emotions, and strong scene continuity.";
  if (videoType === "story") productionBrief.intent = "Tell a coherent story with setup, development, emotional turning point, resolution, and recurring-character memory.";
  if (videoType === "devotional") productionBrief.intent = "Tell a reverent devotional story that preserves the named characters, sacred setting, emotional arc, and requested symbolism without unrelated additions.";

  const explicitScenes = parseSceneBlocks(prompt, productionBrief);
  if (explicitScenes.length) {
    return {
      summary: `Director parsed ${explicitScenes.length} explicit scenes and compiled visual-only prompts with separate dialogue/narration metadata, strict continuity memory, and typography suppression.`,
      continuityContext: productionBrief.continuity,
      productionBrief,
      scenes: applySceneMemory(explicitScenes, productionBrief, continuityMode),
    };
  }

  const sceneCount = Math.max(3, Math.min(12, Math.ceil(durationSeconds / 7.5)));
  const durations = normalizeDurations(sceneCount, durationSeconds);
  const beats = distributedStoryBeats(prompt, sceneCount);
  const scenes = beats.map(({ beat, excerpt }, index) => {
    const scene: ScenePlanItem = {
      order: index + 1,
      title: index === 0 ? "Opening" : index === sceneCount - 1 ? "Resolution" : `Story beat ${index + 1}`,
      duration: durations[index],
      prompt: "",
      storyBeat: beat,
      sourceExcerpt: excerpt,
      visual: beat,
      action: beat,
      camera: productionBrief.cameraLanguage,
      audio: productionBrief.audioDirection,
      mustHave: productionBrief.mustHave,
      narration: excerpt || beat,
      negativePrompt: STORY_NEGATIVE_PROMPT,
    };
    scene.prompt = naturalScenePrompt(scene, productionBrief);
    return scene;
  });

  return {
    summary: `Fallback Director distributed the complete source story across ${sceneCount} chronological scenes instead of reusing only the opening sentences. High Accuracy can replace this fallback with the local multimodal AI Director.`,
    continuityContext: productionBrief.continuity,
    productionBrief,
    scenes: applySceneMemory(scenes, productionBrief, continuityMode),
  };
}

function directorCharacterBible(raw: unknown, fallback: ProductionBrief): CharacterBibleEntry[] {
  if (!Array.isArray(raw)) return fallback.characterBible || [];
  const entries = raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = asString(row.name);
    const appearance = asString(row.appearance);
    if (!name || !appearance) return [];
    return [{
      name,
      role: asString(row.role) || undefined,
      appearance,
      wardrobe: asString(row.wardrobe) || undefined,
      voice: asString(row.voice) || undefined,
      immutableTraits: asStringArray(row.immutableTraits, 20),
    } satisfies CharacterBibleEntry];
  });
  return entries.length ? entries.slice(0, 12) : fallback.characterBible || [];
}

function directorStoryArc(raw: unknown): StoryArc | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const arc = {
    setup: asString(row.setup),
    development: asString(row.development),
    climax: asString(row.climax),
    resolution: asString(row.resolution),
  };
  return Object.values(arc).every(Boolean) ? arc : undefined;
}

export function compileDirectorPlan(
  prompt: string,
  durationSeconds: number,
  _aspectRatio: string,
  continuityMode: ContinuityMode,
  videoType: VideoType,
  raw: unknown,
): ScenePlan {
  void _aspectRatio;
  if (!raw || typeof raw !== "object") return deterministicPlan(prompt, durationSeconds, continuityMode, videoType);
  const data = raw as Record<string, unknown>;
  const fallback = buildProductionBrief(prompt);
  const characterBible = directorCharacterBible(data.characters, fallback);
  const characters = characterBible.map((entry) => entry.name);
  const locations = asStringArray(data.locations, 20);
  const productionBrief: ProductionBrief = {
    ...fallback,
    title: asString(data.title, fallback.title),
    source: "ai-director",
    intent: asString(data.intent, fallback.intent),
    visualStyle: asString(data.visualStyle, fallback.visualStyle),
    characters: characters.length ? characters : fallback.characters,
    locations: locations.length ? locations : fallback.locations,
    cameraLanguage: asString(data.cameraLanguage, fallback.cameraLanguage),
    audioDirection: asString(data.audioDirection, fallback.audioDirection),
    mustHave: unique([...fallback.mustHave, ...asStringArray(data.mustHave, 20)]).slice(0, 20),
    avoid: unique([...fallback.avoid, ...asStringArray(data.avoid, 20)]).slice(0, 20),
    warnings: unique([...fallback.warnings, ...asStringArray(data.warnings, 10)]).slice(0, 20),
    characterBible,
    storyArc: directorStoryArc(data.storyArc),
    sourceSummary: asString(data.sourceSummary),
    narrationStyle: asString(data.narrationStyle),
    continuity: "",
  };
  const locks = memoryLocks(productionBrief);
  productionBrief.continuity = oneLine(`${locks.characterLock} ${locks.worldLock}`).slice(0, 5600);

  const rawScenes = Array.isArray(data.scenes) ? data.scenes : [];
  if (!rawScenes.length) return deterministicPlan(prompt, durationSeconds, continuityMode, videoType);
  const durations = normalizeDurations(Math.min(rawScenes.length, MAX_SCENES), durationSeconds);
  const scenes: ScenePlanItem[] = rawScenes.slice(0, MAX_SCENES).map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const scene: ScenePlanItem = {
      order: index + 1,
      title: asString(row.title, `Scene ${index + 1}`).slice(0, 120),
      duration: durations[index],
      prompt: "",
      storyBeat: asString(row.storyBeat || row.beat),
      sourceExcerpt: asString(row.sourceExcerpt).slice(0, 1800) || undefined,
      visual: asString(row.visual).slice(0, 3000) || undefined,
      action: asString(row.action).slice(0, 3000) || undefined,
      camera: asString(row.camera).slice(0, 1500) || undefined,
      audio: asString(row.audio).slice(0, 1500) || undefined,
      dialogue: asString(row.dialogue).slice(0, 1500) || undefined,
      narration: asString(row.narration).slice(0, 1800) || undefined,
      transition: asString(row.transition).slice(0, 500) || undefined,
      charactersPresent: asStringArray(row.charactersPresent, 12),
      mustHave: asStringArray(row.mustHave, 20),
      negativePrompt: oneLine(`${STORY_NEGATIVE_PROMPT}, ${asString(row.negativePrompt)}`).slice(0, 2400),
    };
    scene.prompt = naturalScenePrompt(scene, productionBrief);
    return scene;
  });
  return {
    summary: asString(data.summary, `AI Director read the complete source and compiled ${scenes.length} chronological scenes with character, world, narration, and continuity memory.`),
    continuityContext: productionBrief.continuity,
    productionBrief,
    scenes: applySceneMemory(scenes, productionBrief, continuityMode),
  };
}

export async function planScenes(
  prompt: string,
  durationSeconds: number,
  _aspectRatio: string,
  continuityMode: ContinuityMode = "balanced",
  videoType: VideoType = "cinematic",
): Promise<ScenePlan> {
  void _aspectRatio;
  return deterministicPlan(prompt, durationSeconds, continuityMode, videoType);
}

export function analyzeVideoPrompt(prompt: string): ProductionBrief {
  return buildProductionBrief(prompt);
}

export async function enhanceVideoPrompt(prompt: string, continuityContext?: string): Promise<string> {
  const clean = normalizeWhitespace(prompt);
  if (clean.length > 900 || /(?:^|\n)\s*(?:#{1,6}\s*)?SCENE\s+\d+/im.test(clean)) return clean;
  return oneLine(`${continuityContext ? `${continuityContext} ` : ""}${clean} Render one coherent chronological action with precise recurring identity, physically plausible motion, intentional camera framing, controlled lighting, a detailed environment, and synchronized scene-appropriate ambience.`).slice(0, 11800);
}
