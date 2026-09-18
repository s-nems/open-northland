import type { DrawItem, PalisadePostDraw } from '../../data/scene/index.js';
import {
  DECOR_BINDING_KEY,
  resolveCraftFxDraw,
  resolvePalisadeDraw,
  resolveResourceDraw,
  resolveSignpostDraw,
  resolveSpriteBobId,
  resolveStockpileDraw,
  resolveVehicleDraw,
} from '../../data/sprites/index.js';
import { shipSway } from '../ship-sway.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import { vegetationShear } from '../vegetation-sway.js';
import { pushBuildingExtras, pushBuildingLayers } from './building-layers.js';
import { pushCharacterLayers } from './character-layers.js';
import {
  hasLoadedFamily,
  layeredLayerFor,
  layerScale,
  pushBodyWithShadow,
  pushLayeredWithShadow,
  resolveFromLayer,
} from './layered-layers.js';
import { LayerBuffer, type ResolvedLayer } from './resolved-layer.js';

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
  vegetationClock: number = tick,
): readonly ResolvedLayer[] | null {
  return resolveLayersInto(new LayerBuffer(), sheet, item, tick, gaitClock, vegetationClock);
}

/**
 * {@link resolveLayers} into a caller-owned buffer, whose previous list it overwrites. The pool resolves
 * every drawn entity every frame, so it refills one buffer per entity instead of allocating a list.
 */
export function resolveLayersInto(
  out: LayerBuffer,
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  tick: number,
  gaitClock: number,
  vegetationClock: number,
): readonly ResolvedLayer[] | null {
  out.reset();
  return pushLayers(out, sheet, item, tick, gaitClock, vegetationClock) ? out.finish() : null;
}

/** Append an entity's layers to an empty buffer; false means the placeholder. */
function pushLayers(
  out: LayerBuffer,
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  tick: number,
  gaitClock: number,
  vegetationClock: number,
): boolean {
  if (sheet === undefined) return false;

  let bobId: number | null;
  switch (item.kind) {
    // A tile binds by landscape typeId; a projectile has no decoded arrow bob and always draws the
    // pool's oriented-arrow marker instead (named gap).
    case 'tile':
    case 'projectile':
      return false;
    case 'settler':
      // Per-job settler character (the `[jobbasegraphics]` join), resolved in that body's own frame-id
      // space. A sheet with no characters falls through to the sheet-global settler path.
      if (sheet.characters !== undefined)
        return pushCharacterLayers(out, sheet, sheet.characters, item, tick, gaitClock);
      bobId = resolveSpriteBobId(item, sheet.bindings, tick, gaitClock);
      break;
    case 'fish': {
      const binding = sheet.bindings.fish;
      if (binding === undefined || sheet.families?.[binding.layer] === undefined) return false;
      return pushFishSchool(out, sheet, item, tick);
    }
    case 'building': {
      const branch = pushBuildingLayers(out, sheet, item, tick);
      if (typeof branch === 'boolean') return branch;
      bobId = branch;
      break;
    }
    case 'palisade':
      return pushPalisadeLayers(out, sheet, item, tick);
    case 'resource': {
      // A layer-qualified ref (a rock/mine `.bmd` family) draws from that family atlas; a bare ref (the
      // default yew) falls through to the `kindLayers.resource` tree layer below. A null draw is a
      // data-pinned invisible level (the original's freshly-sown field): draw nothing, not the placeholder.
      const draw = resolveResourceDraw(sheet.bindings.resource, item);
      if (draw === null) return true;
      if (hasLoadedFamily(sheet, draw)) {
        const sway = draw.layer === undefined ? undefined : sheet.families?.[draw.layer]?.sway;
        const shear =
          sway === undefined
            ? undefined
            : vegetationShear(
                item.ghost === true || item.frozen === true ? 0 : vegetationClock,
                item.x,
                item.y,
                sway,
              );
        return pushLayeredWithShadow(out, sheet, 'resource', draw, shear);
      }
      bobId = draw.bob;
      break;
    }
    case 'stockpile':
      return pushStockpileLayers(out, sheet, item, tick);
    case 'signpost': {
      // Every signpost ref is layer-qualified, so a missing guidepost family draws the placeholder
      // rather than falling through to the shared body atlas (a human frame drawn as a post).
      const draw = resolveSignpostDraw(sheet.bindings.signpost, item);
      if (draw === null || !hasLoadedFamily(sheet, draw)) return false;
      const resolved = layeredLayerFor(sheet, 'signpost', draw);
      if (resolved === null) return false;
      out.push(resolved);
      return true;
    }
    case 'grounddrop':
    case 'stump':
    case 'berrybush':
    case 'chest':
      return pushDecorLayers(out, sheet, item, item.kind);
    case 'craftfx': {
      // Every effect ref is layer-qualified, so an unloaded `ls_smoke` family draws the placeholder rather
      // than a human frame from the shared body atlas.
      const draw = resolveCraftFxDraw(sheet.bindings.craftfx, item, tick);
      if (draw === null || !hasLoadedFamily(sheet, draw)) return false;
      return pushLayeredWithShadow(out, sheet, 'craftfx', draw);
    }
    case 'vehicle': {
      // Every vehicle look names its family atlas; an unloaded one draws the placeholder, never a human
      // frame from the shared body atlas.
      const draw = resolveVehicleDraw(sheet.bindings.vehicle, item, tick, gaitClock);
      if (draw === null || !hasLoadedFamily(sheet, draw)) return false;
      if (draw.sway === 'none' || item.ghost === true)
        return pushLayeredWithShadow(out, sheet, 'vehicle', draw);
      const sway = shipSway(tick, item.x, item.y, draw.sway === 'sailing');
      return pushLayeredWithShadow(out, sheet, 'vehicle', draw, sway.shear, sway.dy);
    }
    default: {
      const _exhaustive: never = item.kind;
      void _exhaustive;
      return false;
    }
  }
  if (bobId === null) return false;

  const scale = layerScale(sheet, item.kind, undefined);
  const kindLayer = sheet.kindLayers?.[item.kind];
  if (kindLayer !== undefined) {
    if (!pushBodyWithShadow(out, kindLayer, bobId, scale)) return false;
    if (item.kind === 'building') pushBuildingExtras(out, sheet, item, tick);
    return true;
  }

  // Shared body atlas + overlay (head) layers, all indexed by the same resolved bob id.
  const body = resolveFromLayer(sheet, bobId, scale);
  if (body !== null) out.push(body);
  for (const layer of sheet.overlays ?? []) {
    const resolved = resolveFromLayer(layer, bobId, scale);
    if (resolved !== null) out.push(resolved);
  }
  return out.length > 0;
}

/** Scratch for {@link pushPalisadeLayers}: one post's layers, then every post's shadows and bodies. */
const PALISADE_POST = new LayerBuffer();
const PALISADE_SHADOWS = new LayerBuffer();
const PALISADE_BODIES = new LayerBuffer();

const NO_POSTS: readonly PalisadePostDraw[] = [];

/** A post's layers moved onto its offset, by the cached layer record and the post. The scene reuses a
 *  post object while its wall is unchanged, so a steady wall allocates nothing here, and an entry dies
 *  with either key. */
const shiftedLayers = new WeakMap<ResolvedLayer, WeakMap<PalisadePostDraw, ResolvedLayer>>();

/** Append the endpoint post and every repeated edge post, grouping all cast shadows below all bodies. */
function pushPalisadeLayers(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem, tick: number): boolean {
  if (item.palisadeSite === 'unclaimed') return true;
  if (item.palisadeSite === 'claimed') return pushStockpileLayers(out, sheet, item, tick);
  const binding = sheet.bindings.palisade;
  if (binding === undefined) return false;
  PALISADE_SHADOWS.reset();
  PALISADE_BODIES.reset();
  if (!appendPalisadePost(sheet, binding, item, null)) return false;
  for (const post of item.palisadePosts ?? NO_POSTS) appendPalisadePost(sheet, binding, post, post);
  for (const layer of PALISADE_SHADOWS.finish()) out.push(layer);
  // An edge's posts ride one endpoint's draw, and toward a neighbour further up the screen they stand
  // behind that endpoint: paint the bodies from the back row forward. The sort is stable, so the layers
  // of one post keep their order; it reorders the scratch list in place.
  const bodies = PALISADE_BODIES.finish() as ResolvedLayer[];
  bodies.sort(byRowOffset);
  for (const layer of bodies) out.push(layer);
  return true;
}

/** Sort the layers of one post into the shadow and body scratch lists, moved onto `post`'s offset when
 *  it is a repeated post rather than the anchor's own. */
function appendPalisadePost(
  sheet: SpriteSheet,
  binding: NonNullable<SpriteSheet['bindings']['palisade']>,
  draw: Pick<DrawItem, 'gfxIndex' | 'builtPct'> & { readonly variantStep?: number },
  post: PalisadePostDraw | null,
): boolean {
  PALISADE_POST.reset();
  if (!pushLayeredWithShadow(PALISADE_POST, sheet, 'palisade', resolvePalisadeDraw(binding, draw)))
    return false;
  for (const layer of PALISADE_POST.finish()) {
    const placed = post === null ? layer : shiftedLayer(layer, post);
    (layer.shadow === true ? PALISADE_SHADOWS : PALISADE_BODIES).push(placed);
  }
  return true;
}

function shiftedLayer(layer: ResolvedLayer, post: PalisadePostDraw): ResolvedLayer {
  if (post.dx === 0 && post.dy === 0) return layer;
  let byPost = shiftedLayers.get(layer);
  if (byPost === undefined) {
    byPost = new WeakMap();
    shiftedLayers.set(layer, byPost);
  }
  let shifted = byPost.get(post);
  if (shifted === undefined) {
    shifted = { ...layer, dx: post.dx, dy: post.dy };
    byPost.set(post, shifted);
  }
  return shifted;
}

function byRowOffset(a: ResolvedLayer, b: ResolvedLayer): number {
  return (a.dy ?? 0) - (b.dy ?? 0);
}

/**
 * Resolve one layer per fish in the authored stock. In the original the
 * renderer loops over the swarm count, moves each fish independently on sinusoidal paths and selects
 * its directional bob from velocity. `fishPoint` deliberately approximates those paths with our own
 * deterministic curves, keeping presentation motion out of the simulation.
 */
function pushFishSchool(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem, tick: number): boolean {
  const binding = sheet.bindings.fish;
  if (binding === undefined || binding.bobs.length === 0) return false;
  const count = Math.max(0, Math.min(30, Math.trunc(item.swarmCount ?? 0)));
  const t = tick / Math.max(1, binding.ticksPerFrame);
  for (let fish = 0; fish < count; fish++) {
    const now = fishPoint(item.ref, fish, t);
    const before = fishPoint(item.ref, fish, t - 0.25);
    const heading = fishHeadingIndex(now.x - before.x, now.y - before.y, binding.bobs.length);
    const bob = binding.bobs[heading];
    if (bob === undefined) continue;
    const layer = layeredLayerFor(sheet, 'fish', { layer: binding.layer, bob });
    if (layer !== null) out.push({ ...layer, dx: now.x, dy: now.y });
  }
  return true;
}

/** Map screen velocity to the original fish sheet's clockwise-descending directional order. */
export function fishHeadingIndex(dx: number, dy: number, headingCount: number): number {
  if (headingCount <= 0) return 0;
  const angle = Math.atan2(dy, dx);
  const turn = (((angle / (Math.PI * 2)) % 1) + 1) % 1;
  return Math.floor((1 - turn) * headingCount) % headingCount;
}

function fishPoint(ref: number, fish: number, t: number): { x: number; y: number } {
  const phase = ref * 0.754877666 + fish * 2.39996323;
  return {
    // Calibrated to the original's 12 Hz world clock: a broad crossing takes tens of seconds, with a
    // smaller ripple layered over it. The phase curves remain our deterministic approximation.
    x: Math.sin(t * 0.0097 + phase) * 90 + Math.sin(t * 0.002 + phase * 1.7) * 20,
    y: Math.sin(t * 0.004 + phase * 1.3) * 60 + Math.sin(t * 0.019 + phase * 0.7) * 20,
  };
}

/**
 * A ground pile / delivery flag has no shared `kindLayers` layer of its own, so it draws only from a
 * loaded named family (the `ls_goods` pile / `ls_temp` flag atlases); anything else draws the
 * placeholder heap. Its cast shadow comes from the family's `_s` twin like every other kind.
 */
function pushStockpileLayers(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem, tick: number): boolean {
  const binding = sheet.bindings.stockpile;
  if (binding === undefined) return false;
  const draw = resolveStockpileDraw(binding, item, tick);
  if (draw.layer === undefined) return false;
  return pushLayeredWithShadow(out, sheet, 'stockpile', draw);
}

/**
 * A stump (`ls_trees_dead` debris), a freshly-felled trunk on the ground (`landscapeToPickup` LOG), a
 * wild berry bush (the `ls_trees` bush frames) or a chest (`ls_chest`). Like {@link pushStockpileLayers}
 * these have no shared `kindLayers` layer, but each resolves through the per-good resource resolver, whose
 * null draw is a data-pinned invisible level: draw nothing, not the placeholder.
 */
function pushDecorLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  item: DrawItem,
  kind: keyof typeof DECOR_BINDING_KEY,
): boolean {
  const binding = sheet.bindings[DECOR_BINDING_KEY[kind]];
  if (binding === undefined) return false;
  const draw = resolveResourceDraw(binding, item);
  if (draw === null) return true;
  if (draw.layer === undefined) return false;
  return pushLayeredWithShadow(out, sheet, kind, draw);
}
