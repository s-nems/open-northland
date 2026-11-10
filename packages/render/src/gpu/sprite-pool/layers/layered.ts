import {
  type AtlasFrame,
  type BuildingDraw,
  type BuildTimeSheet,
  frameHasBuildTimes,
  lookupFrame,
  type ResourceDraw,
  type SpriteKind,
} from '../../../data/sprites/index.js';
import { FOOT_OVERLAY_STRIPS } from '../../ground-foot/index.js';
import type { SpriteLayer, SpriteSheet } from '../../textures/sprite-sheet.js';
import type { LayerBuffer, ResolvedLayer } from './resolved-layer.js';

/**
 * Resolved layers are immutable, and the pool resolves every drawn entity every frame, so each record is
 * built once per atlas frame and reused while the inputs that shaped it still match. Weak keys let a
 * dropped sheet take its records with it.
 */
const bodyRecords = new WeakMap<AtlasFrame, BodyRecord>();
const shadowRecords = new WeakMap<AtlasFrame, ResolvedLayer>();

/** A body record and the time sheet of the layer it was made under, which with the frame decides whether
 *  the record carries build times: the same sheet needs no second look at the frame's time data. */
interface BodyRecord {
  readonly layer: ResolvedLayer;
  readonly under: BuildTimeSheet | undefined;
}

/**
 * Append {@link layeredLayerFor}'s layer plus the body's cast shadow, ordered `[shadow, body]`; false
 * appends nothing and means the placeholder. The construction stack calls {@link layeredLayerFor}
 * directly instead: its stage shadows draw from the stack's own `shadowBobId` lane, not the body twin.
 */
export function pushLayeredWithShadow(
  out: LayerBuffer,
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: ResourceDraw,
  shear?: number,
): boolean {
  const layer = sourceLayerFor(sheet, kind, draw);
  if (layer === undefined) return false;
  return pushBodyWithShadow(out, layer, draw.bob, layeredScale(sheet, kind, draw), shear, draw.looping);
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
  looping?: true,
): boolean {
  const body = resolveFromLayer(layer, bob, scale);
  if (body === null) return false;
  const shadow = shadowLayerFor(layer, bob, scale);
  if (shadow !== null) out.push(shadow);
  if (shear !== undefined) out.push({ ...body, shear });
  else out.push(looping === true ? clockedLayer(body) : body);
  return true;
}

/** Memoized per body record, so a looping frame keeps one identity from tick to tick like any other. */
const clockedRecords = new WeakMap<ResolvedLayer, ResolvedLayer>();

function clockedLayer(body: ResolvedLayer): ResolvedLayer {
  let clocked = clockedRecords.get(body);
  if (clocked === undefined) {
    clocked = { ...body, clocked: true };
    clockedRecords.set(body, clocked);
  }
  return clocked;
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
    cached.under === layer.times &&
    cached.layer.source === layer.source &&
    cached.layer.scale === scale &&
    cached.layer.atlasW === layer.atlas.width &&
    cached.layer.atlasH === layer.atlas.height
  )
    return cached.layer;
  const times = layer.times !== undefined && frameHasBuildTimes(layer.times, frame) ? layer.times : undefined;
  const record: ResolvedLayer = {
    source: layer.source,
    frame,
    scale,
    atlasW: layer.atlas.width,
    atlasH: layer.atlas.height,
    ...(times !== undefined ? { times } : {}),
  };
  bodyRecords.set(frame, { layer: record, under: layer.times });
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

/** The shade, grounded body and cover records of each body record (see {@link pushGroundedFrom}). */
const groundedRecords = new WeakMap<
  ResolvedLayer,
  readonly [readonly ResolvedLayer[], ResolvedLayer, readonly ResolvedLayer[]]
>();

/**
 * Append a building body set into the ground, ordered `[shade strips, shadow, body, cover strips]`; false
 * appends nothing and means the placeholder.
 */
export function pushGroundedBody(
  out: LayerBuffer,
  sheet: SpriteSheet,
  kind: SpriteKind,
  draw: BuildingDraw,
  wrap: (part: ResolvedLayer) => ResolvedLayer = identity,
): boolean {
  const layer = sourceLayerFor(sheet, kind, draw);
  if (layer === undefined) return false;
  return pushGroundedFrom(out, layer, draw.bob, layeredScale(sheet, kind, draw), wrap);
}

function identity(part: ResolvedLayer): ResolvedLayer {
  return part;
}

/** {@link pushGroundedBody} for one bob of an already chosen layer; `wrap` restyles every part pushed. */
export function pushGroundedFrom(
  out: LayerBuffer,
  layer: SpriteLayer,
  bob: number,
  scale: number,
  wrap: (part: ResolvedLayer) => ResolvedLayer = identity,
): boolean {
  const body = resolveFromLayer(layer, bob, scale);
  if (body === null) return false;
  let parts = groundedRecords.get(body);
  if (parts === undefined) {
    const overlay = { source: body.source, frame: body.frame, scale, boundsExempt: true } as const;
    const strips = (part: ResolvedLayer): ResolvedLayer[] =>
      Array.from({ length: FOOT_OVERLAY_STRIPS }, (_, footStrip) => ({ ...part, footStrip }));
    parts = [
      strips({ ...overlay, shadow: true, groundFoot: 'shade' }),
      { ...body, groundFoot: 'body' },
      strips({ ...overlay, groundFoot: 'cover' }),
    ];
    groundedRecords.set(body, parts);
  }
  for (const shade of parts[0]) out.push(wrap(shade));
  const shadow = shadowLayerFor(layer, bob, scale);
  if (shadow !== null) out.push(wrap(shadow));
  out.push(wrap(parts[1]));
  for (const cover of parts[2]) out.push(wrap(cover));
  return true;
}
