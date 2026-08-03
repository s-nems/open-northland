import { type BuildingDraw, lookupFrame, type SpriteKind } from '../../data/sprites/index.js';
import type { SpriteLayer, SpriteSheet } from '../sprite-sheet.js';
import type { ResolvedLayer } from './resolved-layer.js';

/**
 * {@link layeredLayerFor} plus the body's cast shadow, ordered `[shadow, body]`. The construction stack
 * calls {@link layeredLayerFor} directly instead: its stage shadows draw from the stack's own
 * `shadowBobId` lane, not the body twin.
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
 * Resolve one layered draw to its atlas layer - the family / dedicated-kind-layer decision shared by
 * every layered kind. Null for an unloaded family, a kind with no dedicated layer, or a missing or
 * empty frame.
 */
export function layeredLayerFor(
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: BuildingDraw,
): ResolvedLayer | null {
  const layer = sourceLayerFor(sheet, kind, draw);
  return layer === undefined ? null : resolveFromLayer(layer, sheet, kind, draw);
}

export function hasLoadedFamily(sheet: SpriteSheet, draw: BuildingDraw): boolean {
  return draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined;
}

/**
 * A named family resolves to its own atlas, a bare draw to the kind layer. An unloaded named family is
 * `undefined`, never a wrong-bob borrow from the kind layer, whose id space differs.
 */
function sourceLayerFor(sheet: SpriteSheet, kind: SpriteKind, draw: BuildingDraw): SpriteLayer | undefined {
  return draw.layer !== undefined ? sheet.families?.[draw.layer] : sheet.kindLayers?.[kind];
}

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
 * The cast shadow a drawn bob prepends under itself: the same bob id in the source layer's shadow twin
 * (shadow bob sets parallel their body's ids - observed on the tree and house `_s.bmd`s). Null when
 * there is no twin or no visible frame at that id; most bobs cast none.
 */
export function shadowLayerFor(layer: SpriteLayer, bobId: number, scale: number): ResolvedLayer | null {
  const shadow = layer.shadow;
  if (shadow === undefined) return null;
  const frame = lookupFrame(shadow.atlas, bobId);
  if (frame === null) return null;
  return { source: shadow.source, frame, scale, boundsExempt: true, shadow: true };
}
