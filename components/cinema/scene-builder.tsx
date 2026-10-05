"use client";

import type { ScenePlan, ScenePlanItem } from "@/lib/types";

function renumber(scenes: ScenePlanItem[]) {
  return scenes.map((scene, index) => ({ ...scene, order: index + 1 }));
}

export function SceneBuilder({ plan, onChange, onClose }: { plan: ScenePlan; onChange: (plan: ScenePlan) => void; onClose: () => void }) {
  function updateScene(index: number, patch: Partial<ScenePlanItem>) {
    const scenes = plan.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene);
    onChange({ ...plan, scenes: renumber(scenes) });
  }

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= plan.scenes.length) return;
    const scenes = [...plan.scenes];
    [scenes[index], scenes[next]] = [scenes[next], scenes[index]];
    onChange({ ...plan, scenes: renumber(scenes) });
  }

  function remove(index: number) {
    if (plan.scenes.length <= 1) return;
    onChange({ ...plan, scenes: renumber(plan.scenes.filter((_, sceneIndex) => sceneIndex !== index)) });
  }

  function addScene() {
    const previous = plan.scenes.at(-1);
    const next: ScenePlanItem = {
      order: plan.scenes.length + 1,
      title: `Scene ${plan.scenes.length + 1}`,
      duration: Math.min(8, previous?.duration || 6),
      prompt: "Continue the story with the same recurring character identities, visual style, world rules, and established continuity. Describe one clear visual beat.",
      action: "Continue the next story beat.",
      mustHave: [],
      memory: previous?.memory ? {
        ...previous.memory,
        previousSceneSummary: `${previous.title}: ${previous.action || previous.visual || previous.prompt}`.slice(0, 900),
        bridgeFromPrevious: true,
      } : undefined,
    };
    onChange({ ...plan, scenes: [...plan.scenes, next] });
  }

  return <div className="sceneBuilder">
    <div className="sceneBuilderHead">
      <div><span className="sceneBuilderEyebrow">SCENE STUDIO · {plan.productionBrief.source === "ai-director" ? "AI DIRECTOR" : "SAFE FALLBACK"}</span><strong>{plan.scenes.length} planned scenes</strong><p>{plan.summary}</p></div>
      <button type="button" className="sceneClose" onClick={onClose}>Hide</button>
    </div>
    <div className="sceneMemoryBanner"><strong>Continuity memory</strong><p>{plan.continuityContext}</p></div>
    {plan.productionBrief.storyArc && <div className="storyArcGrid">
      <div><span>Setup</span><p>{plan.productionBrief.storyArc.setup}</p></div>
      <div><span>Development</span><p>{plan.productionBrief.storyArc.development}</p></div>
      <div><span>Climax</span><p>{plan.productionBrief.storyArc.climax}</p></div>
      <div><span>Resolution</span><p>{plan.productionBrief.storyArc.resolution}</p></div>
    </div>}
    {!!plan.productionBrief.characterBible?.length && <div className="characterBibleStrip">
      {plan.productionBrief.characterBible.map((character) => <div key={character.name}><strong>{character.name}</strong><span>{character.appearance}</span><small>{character.wardrobe}</small></div>)}
    </div>}
    <div className="sceneEditorList">
      {plan.scenes.map((scene, index) => <article className="sceneEditorCard" key={`${scene.order}-${index}`}>
        <div className="sceneEditorTop">
          <span className="sceneNumber">{String(index + 1).padStart(2, "0")}</span>
          <input aria-label={`Scene ${index + 1} title`} value={scene.title} onChange={(event) => updateScene(index, { title: event.target.value.slice(0, 120) })} />
          <label><span>Sec</span><input type="number" min={2} max={20} value={scene.duration} onChange={(event) => updateScene(index, { duration: Math.max(2, Math.min(20, Number(event.target.value) || 2)) })} /></label>
          <div className="sceneReorder"><button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move scene up">↑</button><button type="button" onClick={() => move(index, 1)} disabled={index === plan.scenes.length - 1} aria-label="Move scene down">↓</button><button type="button" onClick={() => remove(index)} disabled={plan.scenes.length <= 1}>Remove</button></div>
        </div>
        <div className="sceneBeatGrid">
          <label><span>Story beat</span><textarea aria-label={`Scene ${index + 1} story beat`} value={scene.storyBeat || ""} maxLength={1200} onChange={(event) => updateScene(index, { storyBeat: event.target.value })} /></label>
          <label><span>Visual / action</span><textarea aria-label={`Scene ${index + 1} visual`} value={scene.visual || scene.action || ""} maxLength={3000} onChange={(event) => updateScene(index, { visual: event.target.value, action: event.target.value })} /></label>
          <label><span>Narration metadata</span><textarea aria-label={`Scene ${index + 1} narration`} value={scene.narration || ""} maxLength={1800} onChange={(event) => updateScene(index, { narration: event.target.value })} /></label>
        </div>
        <details className="compiledPrompt"><summary>Compiled LTX visual prompt</summary><textarea aria-label={`Scene ${index + 1} prompt`} value={scene.prompt} maxLength={5000} onChange={(event) => updateScene(index, { prompt: event.target.value })} /></details>
        {!!scene.charactersPresent?.length && <div className="sceneCharacters"><span>Visible characters</span><strong>{scene.charactersPresent.join(" · ")}</strong></div>}
        {scene.memory && <div className="sceneMemoryGrid">
          <div><span>Character lock</span><p>{scene.memory.characterLock}</p></div>
          <div><span>World lock</span><p>{scene.memory.worldLock}</p></div>
          {scene.memory.previousSceneSummary && <div><span>Previous scene memory</span><p>{scene.memory.previousSceneSummary}</p></div>}
          <div><span>Bridge</span><p>{scene.memory.bridgeFromPrevious ? "Carry the previous rendered frame into this scene when possible." : "Use text memory only for this cut."}</p></div>
        </div>}
      </article>)}
    </div>
    <button type="button" className="addSceneButton" onClick={addScene}>+ Add scene</button>
  </div>;
}
