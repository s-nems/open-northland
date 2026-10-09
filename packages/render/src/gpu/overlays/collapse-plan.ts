import type { DrawItem } from '../../data/scene/index.js';
import { resolveConstructionDraws } from '../../data/sprites/index.js';
import type { FallenBody } from '../building-damage/building-damage.js';
import { damageScaffoldLayers } from '../sprite-pool/building-layers.js';
import { resolveLayers } from '../sprite-pool/index.js';
import { layeredLayerFor } from '../sprite-pool/layered-layers.js';
import type { ResolvedLayer } from '../sprite-pool/resolved-layer.js';
import type { SpriteSheet } from '../sprite-sheet.js';

export interface CollapsePart {
  /** Frozen visible pixels (possibly a damage-atlas lease). */
  readonly draw: ResolvedLayer;
  /** Original construction coordinates and time sheet, before damage or a reveal bake. */
  readonly construction: ResolvedLayer;
  readonly alpha: number;
  readonly introduced: boolean;
  readonly shade: number;
}

const bodyLayer = (layer: ResolvedLayer): boolean => layer.shadow !== true && layer.groundFoot !== 'cover';
const sameFrame = (a: ResolvedLayer, b: ResolvedLayer): boolean =>
  a.source === b.source && a.frame === b.frame;

/** Existing layers unwind in place. A completed body may uncover its own construction backing;
 * incomplete and upgrading stacks already contain their backing and must never gain unbuilt work. */
export function collapsePlan(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  fallen: readonly FallenBody[] | undefined,
): CollapsePart[] {
  const ordinary = resolveLayers(sheet, item, 0)?.filter(bodyLayer) ?? [];
  const stages: ResolvedLayer[] = [];
  if (sheet !== undefined) {
    for (const stage of resolveConstructionDraws(sheet.bindings.building, { ...item, builtPct: 99 }) ?? []) {
      const layer = layeredLayerFor(sheet, 'building', stage);
      if (layer !== null) stages.push({ ...layer, revealWindow: [stage.fromPct, stage.toPct] });
    }
  }
  const visible: CollapsePart[] =
    fallen === undefined
      ? ordinary.map((draw) => ({ draw, construction: draw, alpha: 1, introduced: false, shade: 1 }))
      : fallen.map((body, i) => {
          const draw: ResolvedLayer = {
            source: body.texture.source,
            scale: body.scale,
            frame: { ...body.texture.frame, offsetX: body.x / body.scale, offsetY: body.y / body.scale },
          };
          return {
            draw,
            construction: body.layer ?? ordinary[i] ?? draw,
            alpha: body.alpha,
            introduced: false,
            shade: 1,
          };
        });
  // A replacement art pack without matching construction frames keeps only its visible art.
  const finished = ordinary.find((layer) => stages.some((stage) => sameFrame(stage, layer)));
  const addBacking =
    item.builtPct === undefined &&
    finished !== undefined &&
    visible.every(
      (part) => part.construction.reveal === undefined && part.construction.fadeOutFromPct === undefined,
    );
  const parts: CollapsePart[] = [];
  if (addBacking) {
    const scaffolds = damageScaffoldLayers(sheet, item);
    const damage = Math.max(0, ...(fallen ?? []).map((body) => body.damageLevel ?? 0));
    for (const stage of stages) {
      if (!scaffolds.some((layer) => sameFrame(stage, layer))) continue;
      parts.push({
        draw: stage,
        construction: stage,
        alpha: 1,
        introduced: true,
        shade: 0.9 - damage * 0.035,
      });
    }
  }
  for (const part of visible) {
    const stage = stages.find((candidate) => sameFrame(candidate, part.construction));
    parts.push(
      part.construction.revealWindow !== undefined || stage?.revealWindow === undefined
        ? part
        : { ...part, construction: { ...part.construction, revealWindow: stage.revealWindow } },
    );
  }
  return parts;
}
