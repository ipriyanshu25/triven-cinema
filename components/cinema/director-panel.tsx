"use client";

import type { ProductionBrief, ScenePlanItem } from "@/lib/types";

export function DirectorPanel({ analysis, scenes }: { analysis?: ProductionBrief | null; scenes?: ScenePlanItem[] }) {
  if (!analysis && !scenes?.length) return null;
  return <details className="directorPanel">
    <summary><span>AI Director plan</span><small>{scenes?.length ? `${scenes.length} shot${scenes.length === 1 ? "" : "s"}` : "production brief"}</small></summary>
    <div className="directorBody">
      {analysis && <>
        <div className="directorGrid">
          <div><span>Intent</span><p>{analysis.intent}</p></div>
          <div><span>Visual language</span><p>{analysis.visualStyle}</p></div>
          <div><span>Camera</span><p>{analysis.cameraLanguage}</p></div>
          <div><span>Audio</span><p>{analysis.audioDirection}</p></div>
        </div>
        {(analysis.characters.length > 0 || analysis.locations.length > 0) && <div className="directorFacts">
          {analysis.characters.length > 0 && <div><strong>Characters</strong><span>{analysis.characters.join(" · ")}</span></div>}
          {analysis.locations.length > 0 && <div><strong>Locations</strong><span>{analysis.locations.join(" · ")}</span></div>}
        </div>}
        {analysis.warnings.length > 0 && <div className="directorWarnings"><strong>Production notes</strong>{analysis.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
      </>}
      {scenes?.length ? <div className="shotList">
        {scenes.map((scene) => <div className="shotCard" key={`${scene.order}-${scene.title}`}>
          <div className="shotIndex">{String(scene.order).padStart(2, "0")}</div>
          <div><strong>{scene.title}</strong><small>{scene.duration}s</small><p>{scene.prompt}</p></div>
        </div>)}
      </div> : null}
    </div>
  </details>;
}
