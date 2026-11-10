import type { DrawItem, PalisadePostDraw } from '../../../data/scene/index.js';
import {
  DECOR_BINDING_KEY,
  headingValency,
  particleFrame,
  resolveCraftFxDraw,
  resolvePalisadeDraw,
  resolveResourceDraw,
  resolveSignpostDraw,
  resolveSpriteBobId,
  resolveStockpileDraw,
} from '../../../data/sprites/index.js';
import type { WindSway } from '../../../data/weather/climate.js';
import { vegetationShear } from '../../sway/vegetation.js';
import type { SpriteSheet } from '../../textures/sprite-sheet.js';
import { pushBuildingExtras, pushBuildingLayers } from './building.js';
import { cartDriveLook, pushCartDriveLayers } from './cart-drive.js';
import { pushCharacterLayers } from './character.js';
import { pushFishSchool } from './fish.js';
import {
  hasLoadedFamily,
  layeredLayerFor,
  layerScale,
  pushBodyWithShadow,
  pushGroundedBody,
  pushGroundedFrom,
  pushLayeredWithShadow,
  resolveFromLayer,
} from './layered.js';
import { LayerBuffer, type ResolvedLayer } from './resolved-layer.js';
import { pushShipYardSiteLayers, pushVehicleLayers } from './vehicle.js';

/** Kinds whose layers read no clock: see {@link resolvesWithoutClock}. */
const CLOCKLESS_KINDS: ReadonlySet<DrawItem['kind']> = new Set<DrawItem['kind']>([
  'resource',
  'stump',
  'berrybush',
  'chest',
  'grounddrop',
  'signpost',
]);

/**
 * Whether `item`'s layers resolve from the item alone, reading no clock, so a still one presents the
 * same layers on every frame: a goods pile, unlike the waving delivery flag, and the kinds above. A
 * swaying or looping node is the exception: its body carries a `shear` off the vegetation clock or a
 * `clocked` frame, which the pool reads off the bound layers.
 */
export function resolvesWithoutClock(item: DrawItem): boolean {
  return CLOCKLESS_KINDS.has(item.kind) || (item.kind === 'stockpile' && item.goodType !== undefined);
}

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
  wind?: WindSway,
): readonly ResolvedLayer[] | null {
  return resolveLayersInto(
    new LayerBuffer(),
    sheet,
    item,
    tick,
    gaitClock,
    vegetationClock,
    undefined,
    wind,
    tick,
  );
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
  idleElapsed?: number,
  wind?: WindSway,
  // A ship's swell and sail clock, in ticks; the water clock on the map.
  seaClock: number = tick,
): readonly ResolvedLayer[] | null {
  out.reset();
  return pushLayers(out, sheet, item, tick, gaitClock, vegetationClock, idleElapsed, wind, seaClock)
    ? out.finish()
    : null;
}

/** Append an entity's layers to an empty buffer; false means the placeholder. */
function pushLayers(
  out: LayerBuffer,
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  tick: number,
  gaitClock: number,
  vegetationClock: number,
  idleElapsed: number | undefined,
  wind: WindSway | undefined,
  seaClock: number,
): boolean {
  if (sheet === undefined) return false;

  let bobId: number | null;
  // Set by a looping resource frame drawn from the kind's own layer.
  let looping: true | undefined;
  switch (item.kind) {
    case 'tile':
      return false;
    case 'projectile':
      return pushProjectileLayers(out, sheet, item, tick);
    case 'settler': {
      // A carrier pulling its hauling cart is the cart's driving figure (`./cart-drive.ts`).
      const pulling = cartDriveLook(sheet, item);
      if (pulling !== undefined) return pushCartDriveLayers(out, sheet, pulling, item, tick, gaitClock);
      // Per-job settler character (the `[jobbasegraphics]` join), resolved in that body's own frame-id
      // space. A sheet with no characters falls through to the sheet-global settler path.
      if (sheet.characters !== undefined)
        return pushCharacterLayers(out, sheet, sheet.characters, item, tick, gaitClock, idleElapsed);
      bobId = resolveSpriteBobId(item, sheet.bindings, tick, gaitClock, idleElapsed);
      break;
    }
    case 'fish': {
      const binding = sheet.bindings.fish;
      if (binding === undefined || sheet.families?.[binding.layer] === undefined) return false;
      return pushFishSchool(out, sheet, item, tick);
    }
    case 'building': {
      if (pushShipYardSiteLayers(out, sheet, item)) return true;
      const branch = pushBuildingLayers(out, sheet, item, tick);
      if (typeof branch === 'boolean') return branch;
      bobId = branch;
      break;
    }
    case 'palisade':
      return pushPalisadeLayers(out, sheet, item, tick);
    // The plot itself is the binder's marker; a claimed site adds the builder's flag planted in it.
    case 'roadsite':
      return item.roadSite === 'claimed' ? pushStockpileLayers(out, sheet, item, tick) : true;
    case 'resource': {
      // A layer-qualified ref (a rock/mine `.bmd` family) draws from that family atlas; a bare ref (the
      // default yew) falls through to the `kindLayers.resource` tree layer below. A null draw is a
      // data-pinned invisible level (the original's freshly-sown field): draw nothing, not the placeholder.
      // Art a presentation pack ships with its own `sway` holds its first frame and leans; the original's
      // looping records play their frames instead.
      const binding = sheet.bindings.resource;
      let draw = resolveResourceDraw(binding, item, frozenTick(item, tick));
      if (draw === null) return true;
      const sway = draw.layer === undefined ? undefined : sheet.families?.[draw.layer]?.sway;
      const packArt =
        sway !== undefined || (draw.layer === undefined && sheet.kindLayers?.resource?.sway !== undefined);
      if (packArt && draw.looping === true) draw = resolveResourceDraw(binding, item) ?? draw;
      if (hasLoadedFamily(sheet, draw)) {
        const shear =
          sway === undefined
            ? undefined
            : vegetationShear(
                item.ghost === true || item.frozen === true ? 0 : vegetationClock,
                item.x,
                item.y,
                sway,
                item.ghost === true || item.frozen === true ? undefined : wind,
              );
        return pushLayeredWithShadow(out, sheet, 'resource', draw, shear);
      }
      bobId = draw.bob;
      looping = draw.looping;
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
      return pushDecorLayers(out, sheet, item, item.kind, tick);
    case 'craftfx': {
      // Every effect ref is layer-qualified, so an unloaded `ls_smoke` family draws the placeholder rather
      // than a human frame from the shared body atlas.
      const draw = resolveCraftFxDraw(sheet.bindings.craftfx, item, tick);
      if (draw === null || !hasLoadedFamily(sheet, draw)) return false;
      return pushLayeredWithShadow(out, sheet, 'craftfx', draw);
    }
    case 'vehicle':
      return pushVehicleLayers(out, sheet, item, tick, gaitClock, seaClock, wind);
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
    if (item.kind === 'building') {
      if (!pushGroundedFrom(out, kindLayer, bobId, scale)) return false;
      pushBuildingExtras(out, sheet, item, tick);
      return true;
    }
    return pushBodyWithShadow(out, kindLayer, bobId, scale, undefined, looping);
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
  if (!appendPalisadePost(sheet, binding, item, null, item.player)) return false;
  for (const post of item.palisadePosts ?? NO_POSTS)
    appendPalisadePost(sheet, binding, post, post, item.player);
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
  player: number | undefined,
): boolean {
  PALISADE_POST.reset();
  if (!pushGroundedBody(PALISADE_POST, sheet, 'palisade', resolvePalisadeDraw(binding, draw, player)))
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
 * A shot's `[particel]` frame: an arrow's heading frame, while a siege shot draws nothing here because
 * the shot layer flies it on its own clock. An unbound munition draws the pool's oriented-arrow marker.
 */
function pushProjectileLayers(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem, tick: number): boolean {
  const ref = item.munition === undefined ? undefined : sheet.bindings.munition?.byMunition[item.munition];
  if (ref === undefined || sheet.families?.[ref.layer] === undefined) return false;
  if (item.siege === true) return true;
  const valency = ref.directional ? headingValency(item.rotation ?? 0, ref.valencies.length) : 0;
  const bob = particleFrame(ref, tick, valency);
  if (bob === undefined) return false;
  const layer = layeredLayerFor(sheet, 'projectile', { layer: ref.layer, bob });
  if (layer === null) return false;
  out.push(layer);
  return true;
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
  tick: number,
): boolean {
  const binding = sheet.bindings[DECOR_BINDING_KEY[kind]];
  if (binding === undefined) return false;
  const draw = resolveResourceDraw(binding, item, frozenTick(item, tick));
  if (draw === null) return true;
  if (draw.layer === undefined) return false;
  return pushLayeredWithShadow(out, sheet, kind, draw);
}

/** The clock a looping node plays on; a fog ghost or a frozen portrait holds its first frame. */
function frozenTick(item: DrawItem, tick: number): number | undefined {
  return item.ghost === true || item.frozen === true ? undefined : tick;
}
