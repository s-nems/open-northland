import { type BuildingDraw, lookupFrame, type SpriteKind } from '../../data/sprites/index.js';
import type { SpriteLayer, SpriteSheet } from '../sprite-sheet.js';
import type { ResolvedLayer } from './resolved-layer.js';

/**
 * {@link layeredLayerFor} plus the body's cast shadow: `[shadow, body]` when the draw's source layer
 * carries a {@link SpriteLayer.shadow} twin with a visible frame at the same bob id, else `[body]`;
 * null exactly when {@link layeredLayerFor} is. The construction stack keeps {@link layeredLayerFor}
 * directly - its stage shadows draw from the stack's own `shadowBobId` lane, not the body twin.
 */
export function layeredLayersWithShadow(
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: BuildingDraw,
): ResolvedLayer[] | null {
  const layer = sourceLayerFor(sheet, kind, draw);
  if (layer === undefined) return null;
  const body = resolveFromLayer(layer, sheet, kind, draw);
  if (body === null) return null;
  const shadow = shadowLayerFor(layer, draw.bob, body.scale);
  return shadow === null ? [body] : [shadow, body];
}

/**
 * Resolve one layered draw (a finished building body / construction stage, or a per-good resource /
 * stockpile object) to its atlas layer - the family / dedicated-kind-layer decision shared by every
 * layered kind. Returns null for an unloaded family, a kind with no dedicated layer, or a
 * missing/empty frame (the caller skips or falls back to the placeholder).
 */
export function layeredLayerFor(
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: BuildingDraw,
): ResolvedLayer | null {
  const layer = sourceLayerFor(sheet, kind, draw);
  return layer === undefined ? null : resolveFromLayer(layer, sheet, kind, draw);
}

/** Whether a layered draw names a family atlas the sheet actually loaded. A named-but-unloaded family
 *  is not, so the caller falls through to the bare bob instead. */
export function hasLoadedFamily(sheet: SpriteSheet, draw: BuildingDraw): boolean {
  return draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined;
}

/**
 * The source atlas layer a layered draw reads: a `draw.layer` names a {@link SpriteSheet.families}
 * atlas, a bare draw uses the kind's own {@link SpriteSheet.kindLayers} layer. An unloaded named
 * family is `undefined` - never a wrong-bob borrow from the kind layer (their id spaces differ).
 */
function sourceLayerFor(sheet: SpriteSheet, kind: SpriteKind, draw: BuildingDraw): SpriteLayer | undefined {
  return draw.layer !== undefined ? sheet.families?.[draw.layer] : sheet.kindLayers?.[kind];
}

/** {@link layeredLayerFor}'s frame/scale step over an already-picked source layer: the draw's bob frame
 *  at the family's `familyScales` entry, else the kind's `kindScales`, else native. The atlas's time
 *  sheet rides along so a construction stage can reveal per-pixel; ignored on every other draw. */
function resolveFromLayer(
  layer: SpriteLayer,
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: BuildingDraw,
): ResolvedLayer | null {
  const frame = lookupFrame(layer.atlas, draw.bob);
  if (frame === null) return null;
  const scale =
    (draw.layer !== undefined ? sheet.familyScales?.[draw.layer] : undefined) ??
    sheet.kindScales?.[kind] ??
    1;
  return {
    source: layer.source,
    frame,
    scale,
    ...(layer.times !== undefined ? { times: layer.times } : {}),
  };
}

/**
 * Resolve the cast-shadow layer a drawn bob prepends under itself: the same bob id looked up in the
 * source layer's {@link SpriteLayer.shadow} twin (shadow bob sets parallel their body's ids - observed
 * on the tree and house `_s.bmd`s). Null when the layer has no shadow twin or the twin holds no visible
 * frame at that id (most bobs cast none - the data decides).
 */
export function shadowLayerFor(layer: SpriteLayer, bobId: number, scale: number): ResolvedLayer | null {
  const shadow = layer.shadow;
  if (shadow === undefined) return null;
  const frame = lookupFrame(shadow.atlas, bobId);
  if (frame === null) return null;
  return { source: shadow.source, frame, scale, boundsExempt: true, shadow: true };
}
