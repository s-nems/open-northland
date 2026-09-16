import type { DrawItem } from '../../data/scene/index.js';
import {
  lookupFrame,
  resolveResourceDraw,
  resolveSignpostDraw,
  resolveSpriteBobId,
  resolveStockpileDraw,
} from '../../data/sprites/index.js';
import type { SpriteLayer, SpriteSheet } from '../sprite-sheet.js';
import { vegetationShear } from '../vegetation-sway.js';
import { resolveBuildingLayers } from './building-layers.js';
import { resolveCharacterLayers } from './character-layers.js';
import {
  hasLoadedFamily,
  layeredLayerFor,
  layeredLayersWithShadow,
  shadowLayerFor,
} from './layered-layers.js';
import type { ResolvedLayer } from './resolved-layer.js';

/** Shared empty list so a non-building draw allocates nothing. */
const NO_EXTRAS: readonly ResolvedLayer[] = [];

/**
 * Resolve the ordered atlas layers an entity draws, or `null` to draw the placeholder. Returns layer
 * data, never display objects, so the pool keeps reusing its sprites.
 */
export function resolveLayers(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  tick: number,
  // The motion-scaled walk-cycle clock; defaults to the free tick for callers with no motion track.
  gaitClock: number = tick,
): ResolvedLayer[] | null {
  if (sheet === undefined) return null;

  let bobId: number | null;
  // Layers appended above a building's body draw: a finished building's animated state overlay (the
  // mill's rotor) and/or an upgrading building's revealing next-tier stack.
  let buildingExtras: readonly ResolvedLayer[] = NO_EXTRAS;
  switch (item.kind) {
    // A tile binds by landscape typeId; a projectile has no decoded arrow bob and always draws the
    // pool's oriented-arrow marker instead (named gap).
    case 'tile':
    case 'projectile':
      return null;
    case 'settler':
      // Per-job settler character (the `[jobbasegraphics]` join), resolved in that body's own frame-id
      // space. A sheet with no characters falls through to the sheet-global settler path.
      if (sheet.characters !== undefined)
        return resolveCharacterLayers(sheet.characters, item, tick, gaitClock);
      bobId = resolveSpriteBobId(item, sheet.bindings, tick);
      break;
    case 'fish': {
      const binding = sheet.bindings.fish;
      if (binding === undefined || sheet.families?.[binding.layer] === undefined) return null;
      const bob = resolveSpriteBobId(item, sheet.bindings, tick);
      if (bob === null) return null;
      const resolved = layeredLayerFor(sheet, 'fish', { layer: binding.layer, bob });
      return resolved === null ? null : [resolved];
    }
    case 'building': {
      const branch = resolveBuildingLayers(sheet, item, tick);
      if (branch.done) return branch.layers;
      bobId = branch.bobId;
      buildingExtras = branch.extras;
      break;
    }
    case 'resource': {
      // A layer-qualified ref (a rock/mine `.bmd` family) draws from that family atlas; a bare ref (the
      // default yew) falls through to the `kindLayers.resource` tree layer below. A null draw is a
      // data-pinned invisible level (the original's freshly-sown field): draw nothing, not the placeholder.
      const draw = resolveResourceDraw(sheet.bindings.resource, item);
      if (draw === null) return [];
      if (hasLoadedFamily(sheet, draw)) {
        const layers = layeredLayersWithShadow(sheet, 'resource', draw);
        const sway = draw.layer === undefined ? undefined : sheet.families?.[draw.layer]?.sway;
        if (sway === undefined || layers === null) return layers;
        const shear = vegetationShear(item.ghost === true ? 0 : tick, item.x, item.y, sway);
        return layers.map((layer) => (layer.shadow ? layer : { ...layer, shear }));
      }
      bobId = draw.bob;
      break;
    }
    case 'stockpile':
      return resolveStockpileLayers(sheet, item, tick);
    case 'signpost': {
      // Every signpost ref is layer-qualified, so a missing guidepost family draws the placeholder
      // rather than falling through to the shared body atlas (a human frame drawn as a post).
      const draw = resolveSignpostDraw(sheet.bindings.signpost, item);
      if (draw === null || !hasLoadedFamily(sheet, draw)) return null;
      const resolved = layeredLayerFor(sheet, 'signpost', draw);
      return resolved === null ? null : [resolved];
    }
    case 'grounddrop':
    case 'stump':
    case 'berrybush':
    case 'chest':
      return resolveDecorLayers(sheet, item, item.kind);
    default: {
      const _exhaustive: never = item.kind;
      void _exhaustive;
      return null;
    }
  }
  if (bobId === null) return null;

  const kindLayer = sheet.kindLayers?.[item.kind];
  if (kindLayer !== undefined) {
    const frame = lookupFrame(kindLayer.atlas, bobId);
    if (frame === null) return null;
    const scale = sheet.kindScales?.[item.kind] ?? 1;
    const shadow = shadowLayerFor(kindLayer, bobId, scale);
    const layers: ResolvedLayer[] = shadow === null ? [] : [shadow];
    layers.push({ source: kindLayer.source, frame, scale });
    layers.push(...buildingExtras);
    return layers;
  }

  // Shared body atlas + overlay (head) layers, all indexed by the same resolved bob id.
  const id = bobId;
  const layers: ResolvedLayer[] = [];
  const add = (layer: SpriteLayer): void => {
    const frame = lookupFrame(layer.atlas, id);
    if (frame !== null) {
      layers.push({ source: layer.source, frame, scale: 1 });
    }
  };
  add({ source: sheet.source, atlas: sheet.atlas });
  for (const overlay of sheet.overlays ?? []) add(overlay);
  return layers.length > 0 ? layers : null;
}

/**
 * A ground pile / delivery flag has no shared `kindLayers` layer of its own, so it draws only from a
 * loaded named family (the `ls_goods` pile / `ls_temp` flag atlases); anything else draws the
 * placeholder heap. Its cast shadow comes from the family's `_s` twin like every other kind.
 */
function resolveStockpileLayers(sheet: SpriteSheet, item: DrawItem, tick: number): ResolvedLayer[] | null {
  const binding = sheet.bindings.stockpile;
  if (binding === undefined) return null;
  const draw = resolveStockpileDraw(binding, item, tick);
  if (draw.layer === undefined) return null;
  return layeredLayersWithShadow(sheet, 'stockpile', draw);
}

/** The decor kinds with no shared `kindLayers` layer, each bound under its own key. */
const DECOR_BINDING_KEY = {
  grounddrop: 'trunk',
  stump: 'stump',
  berrybush: 'berrybush',
  chest: 'chest',
} as const;

/**
 * A stump (`ls_trees_dead` debris), a freshly-felled trunk on the ground (`landscapeToPickup` LOG), a
 * wild berry bush (the `ls_trees` bush frames) or a chest (`ls_chest`). Like {@link resolveStockpileLayers}
 * these have no shared `kindLayers` layer, but each resolves through the per-good resource resolver, whose
 * null draw is a data-pinned invisible level: draw nothing, not the placeholder.
 */
function resolveDecorLayers(
  sheet: SpriteSheet,
  item: DrawItem,
  kind: keyof typeof DECOR_BINDING_KEY,
): ResolvedLayer[] | null {
  const binding = sheet.bindings[DECOR_BINDING_KEY[kind]];
  if (binding === undefined) return null;
  const draw = resolveResourceDraw(binding, item);
  if (draw === null) return [];
  if (draw.layer === undefined) return null;
  return layeredLayersWithShadow(sheet, kind, draw);
}
