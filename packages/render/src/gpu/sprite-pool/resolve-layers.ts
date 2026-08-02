import type { DrawItem } from '../../data/scene/index.js';
import {
  lookupFrame,
  resolveResourceDraw,
  resolveSignpostDraw,
  resolveSpriteBobId,
  resolveStockpileDraw,
} from '../../data/sprites/index.js';
import type { SpriteLayer, SpriteSheet } from '../sprite-sheet.js';
import { resolveBuildingLayers } from './building-layers.js';
import { resolveCharacterLayers } from './character-layers.js';
import {
  hasLoadedFamily,
  layeredLayerFor,
  layeredLayersWithShadow,
  shadowLayerFor,
} from './layered-layers.js';
import type { ResolvedLayer } from './resolved-layer.js';

/**
 * The layer-resolution step of the pool's per-frame update: which atlas layers (source + frame +
 * scale) an entity draws this frame, or `null` for the placeholder. Returns data instead of display
 * objects so the pool can reuse its pooled sprites. Free functions of the immutable-per-session
 * {@link SpriteSheet}.
 */

/** Shared empty extras list so a settler or projectile draw allocates nothing on its way through the
 *  kind dispatch (only a building ever replaces it). */
const NO_EXTRAS: readonly ResolvedLayer[] = [];

/**
 * Resolve the ordered atlas layers an entity draws, or `null` to draw the placeholder - the family →
 * kind-layer → shared-body decision. A loaded family/kind layer with a missing or empty frame returns
 * `null` rather than borrowing a frame from another layer, since their id spaces differ.
 */
export function resolveLayers(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  tick: number,
  // The moving-state walk-cycle clock (the pool's motion-scaled gait phase); defaults to the free
  // tick for callers without a motion track (ghost previews, tests).
  gaitClock: number = tick,
): ResolvedLayer[] | null {
  if (sheet === undefined) return null;

  let bobId: number | null;
  // Layers a building appends ABOVE its body draw - a finished building's animated state overlay (the
  // mill's rotor) and/or an upgrading building's revealing next-tier stack - resolved inside the
  // building branch and appended to whichever body layer this frame draws.
  let buildingExtras: readonly ResolvedLayer[] = NO_EXTRAS;
  switch (item.kind) {
    // Tiles bind by landscape typeId; a projectile has no decoded arrow bob (only character bodies are
    // extracted) and always draws the pool's oriented-arrow marker instead (named gap).
    case 'tile':
    case 'projectile':
      return null;
    case 'settler':
      // Per-job settler character (the `[jobbasegraphics]` join): the job's own body + one stable head
      // pick + its own binding, resolved in that body's frame-id space. A sheet with no characters (the
      // synthetic one) falls through to the sheet-global settler path.
      if (sheet.characters !== undefined)
        return resolveCharacterLayers(sheet.characters, item, tick, gaitClock);
      bobId = resolveSpriteBobId(item, sheet.bindings, tick);
      break;
    case 'building': {
      const branch = resolveBuildingLayers(sheet, item, tick);
      if (branch.done) return branch.layers;
      bobId = branch.bobId;
      buildingExtras = branch.extras;
      break;
    }
    case 'resource': {
      // A resource node resolves its per-good draw the same way a building does: a layer-qualified ref
      // (a rock/mine `.bmd` family) draws from that family atlas; a bare ref (the default yew) falls
      // through to the `kindLayers.resource` tree layer (or the shared synthetic atlas) below. The
      // reducer only emits a layer for a loaded family, so a layer-qualified miss is a real gap
      // (placeholder), never a wrong-bob borrow from the tree atlas. A null draw is a data-pinned
      // invisible level (the original's freshly-sown field) - draw nothing, not the placeholder.
      const draw = resolveResourceDraw(sheet.bindings.resource, item);
      if (draw === null) return [];
      if (hasLoadedFamily(sheet, draw)) return layeredLayersWithShadow(sheet, 'resource', draw);
      bobId = draw.bob;
      break;
    }
    case 'stockpile':
      return resolveStockpileLayers(sheet, item);
    case 'signpost': {
      // A signpost (post or one of its direction boards) draws its layer-qualified frame from the
      // guidepost family atlas. Every signpost ref IS layer-qualified (human-sheet emits the binding only
      // for loaded families), so a missing family here is a placeholder, never a bare-bob fall-through
      // into the shared body atlas (a human frame drawn as a post).
      const draw = resolveSignpostDraw(sheet.bindings.signpost, item);
      if (draw === null || !hasLoadedFamily(sheet, draw)) return null;
      const resolved = layeredLayerFor(sheet, 'signpost', draw);
      return resolved === null ? null : [resolved];
    }
    case 'grounddrop':
    case 'stump':
    case 'berrybush':
      return resolveDecorLayers(sheet, item, item.kind);
    default: {
      // Exhaustiveness guard, the twin of `resolveSpriteBobId`'s: the two dispatches cannot silently
      // disagree about a new DrawKind.
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
 * Resolve a ground pile / delivery flag's layers. It has no shared `kindLayers` layer of its own, so it
 * draws only from a loaded named family (the `ls_goods` pile / `ls_temp` flag atlases); a bare or
 * unloaded-family ref draws the placeholder heap. Each layer prepends its cast shadow like every other
 * kind (`ls_goods_s` holds a silhouette for every pile bob in the owned copy).
 */
function resolveStockpileLayers(sheet: SpriteSheet, item: DrawItem): ResolvedLayer[] | null {
  const binding = sheet.bindings.stockpile;
  if (binding === undefined) return null;
  // A stockpile draws a single graphic - its heap or its delivery flag; piles never stack layers.
  const draw = resolveStockpileDraw(binding, item);
  if (draw.layer === undefined) return null; // no family -> placeholder heap/flag, never a wrong atlas borrow
  return layeredLayersWithShadow(sheet, 'stockpile', draw);
}

/**
 * Resolve a decor entity's layers - a stump (`ls_trees_dead` debris), a freshly-felled trunk on the
 * ground (`landscapeToPickup` LOG) or a wild berry bush (the `ls_trees` bush frames). Like the stockpile
 * they have no shared `kindLayers` layer, so each draws only from a loaded named family (else the
 * placeholder), reusing the per-good resource resolver. The DrawKind names the entity, the binding key
 * names the graphic: grounddrop → `trunk`, berrybush → `berrybush`.
 */
function resolveDecorLayers(
  sheet: SpriteSheet,
  item: DrawItem,
  kind: 'grounddrop' | 'stump' | 'berrybush',
): ResolvedLayer[] | null {
  const binding =
    kind === 'stump'
      ? sheet.bindings.stump
      : kind === 'berrybush'
        ? sheet.bindings.berrybush
        : sheet.bindings.trunk;
  if (binding === undefined) return null;
  const draw = resolveResourceDraw(binding, item);
  if (draw === null) return []; // a data-pinned invisible level - draw nothing, not the placeholder
  if (draw.layer === undefined) return null; // no family → placeholder
  return layeredLayersWithShadow(sheet, kind, draw);
}
