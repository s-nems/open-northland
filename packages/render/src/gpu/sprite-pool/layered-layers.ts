import {
  type AtlasFrame,
  type BuildingDraw,
  lookupFrame,
  type SpriteKind,
} from '../../data/sprites/index.js';
import type { SpriteLayer, SpriteSheet } from '../sprite-sheet.js';
import type { LayerBuffer, ResolvedLayer } from './resolved-layer.js';

/**
 * Resolved layers are immutable, and the pool resolves every drawn entity every frame, so each record is
 * built once per atlas frame and reused while the inputs that shaped it still match. Weak keys let a
 * dropped sheet take its records with it.
 */
const bodyRecords = new WeakMap<AtlasFrame, ResolvedLayer>();
const shadowRecords = new WeakMap<AtlasFrame, ResolvedLayer>();

/**
 * Append {@link layeredLayerFor}'s layer plus the body's cast shadow, ordered `[shadow, body]`; false
 * appends nothing and means the placeholder. The construction stack calls {@link layeredLayerFor}
 * directly instead: its stage shadows draw from the stack's own `shadowBobId` lane, not the body twin.
 */
export function pushLayeredWithShadow(
  out: LayerBuffer,
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: BuildingDraw,
  shear?: number,
): boolean {
  const layer = sourceLayerFor(sheet, kind, draw);
  if (layer === undefined) return false;
  return pushBodyWithShadow(out, layer, draw.bob, layeredScale(sheet, kind, draw), shear);
}

/**
 * Append one bob's `[shadow, body]` from a layer; false appends nothing: the body has no frame there. A
 * `shear` sways the body only, since the shadow lies on the ground.
 */
export function pushBodyWithShadow(
  out: LayerBuffer,
  layer: SpriteLayer,
  bob: number,
  scale: number,
  shear?: number,
): boolean {
  const body = resolveFromLayer(layer, bob, scale);
  if (body === null) return false;
  const shadow = shadowLayerFor(layer, bob, scale);
  if (shadow !== null) out.push(shadow);
  out.push(shear === undefined ? body : { ...body, shear });
  return true;
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
  return layer === undefined ? null : resolveFromLayer(layer, draw.bob, layeredScale(sheet, kind, draw));
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

/**
 * The render scale of one draw, applied about the feet anchor: the scale authored with its own art (a
 * family's, a character's) wins over its kind's, and absent both it draws native bob pixels.
 */
export function layerScale(
  sheet: Pick<SpriteSheet, 'kindScales'>,
  kind: SpriteKind,
  own: number | undefined,
): number {
  return own ?? sheet.kindScales?.[kind] ?? 1;
}

function layeredScale(sheet: SpriteSheet, kind: SpriteKind, draw: BuildingDraw): number {
  return layerScale(sheet, kind, draw.layer !== undefined ? sheet.familyScales?.[draw.layer] : undefined);
}

/** One bob of one atlas layer, or null for a missing or empty frame. */
export function resolveFromLayer(
  layer: Pick<SpriteLayer, 'source' | 'atlas' | 'times'>,
  bob: number,
  scale: number,
): ResolvedLayer | null {
  const frame = lookupFrame(layer.atlas, bob);
  if (frame === null) return null;
  const cached = bodyRecords.get(frame);
  if (
    cached !== undefined &&
    cached.source === layer.source &&
    cached.scale === scale &&
    cached.atlasW === layer.atlas.width &&
    cached.atlasH === layer.atlas.height &&
    cached.times === layer.times
  )
    return cached;
  const record: ResolvedLayer = {
    source: layer.source,
    frame,
    scale,
    atlasW: layer.atlas.width,
    atlasH: layer.atlas.height,
    ...(layer.times !== undefined ? { times: layer.times } : {}),
  };
  bodyRecords.set(frame, record);
  return record;
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
  const cached = shadowRecords.get(frame);
  if (cached !== undefined && cached.source === shadow.source && cached.scale === scale) return cached;
  const record: ResolvedLayer = { source: shadow.source, frame, scale, boundsExempt: true, shadow: true };
  shadowRecords.set(frame, record);
  return record;
}
