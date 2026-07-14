import type { WorldSnapshot } from '@open-northland/sim';
import { type ElevationField, terrainLiftAt } from '../elevation.js';
import type { FogGhost } from '../fog-ghosts.js';
import { ONE, tileToScreen } from '../iso.js';
import { isVisible, type Viewport } from '../viewport.js';
import { assignProjectileArc, assignSettlerFields, pushGhostItems, spriteDepth } from './collect-fields.js';
import type { DrawItem, MutableDrawItem, SpriteState } from './draw-item.js';
import { enterableStoresOf, TARGET_FACING_ATOMIC_IDS, targetPositionsOf } from './snapshot-index.js';
import {
  assignStaticFields,
  classify,
  facingTowardTile,
  readActingAtomic,
  readAtomicTargetEntity,
  readBerryBushGfxIndex,
  readBerryBushLevel,
  readPosition,
  readProducing,
  readResourceLevelCount,
  readSpriteState,
  readStockpile,
  readStoreExchangeRef,
} from './snapshot-readers/index.js';

/**
 * The pure sprite-scene builder: turns a {@link WorldSnapshot} into a flat, depth-sorted list of sprite
 * draw items in isometric screen space (plain data, no Pixi), plus the pre-cull liveness set the retained
 * pool reconciles against. This module owns the projection, the cull, and the depth order; the component
 * reads live in {@link import('./snapshot-readers/index.js')}, the per-snapshot pre-scan memos in
 * {@link import('./snapshot-index.js')}, and the per-kind item tagging in
 * {@link import('./collect-fields.js')}.
 *
 * Floats are fine here: `render` is a pure consumer of sim state (docs/ARCHITECTURE.md). The snapshot's
 * `Fixed` position (a scaled integer) is divided by ONE to a float tile coordinate; nothing feeds back
 * into the sim.
 */

/** One frame's sprite scene: the culled, depth-sorted draw list plus the pre-cull liveness set,
 *  produced in a single pass over the snapshot (see {@link collectSpriteScene}). */
export interface SpriteScene {
  readonly items: DrawItem[];
  /** Ids of every drawable entity before the cull — the set the retained pool reconciles against
   *  (an id missing here has died; one present but not in {@link items} is merely off-screen). */
  readonly liveRefs: ReadonlySet<number>;
}

/** The optional inputs of a scene build. Every field accepts an explicit `undefined` so callers can
 *  pass through their own optionals directly. */
export interface SpriteSceneOptions {
  /** The (margin-inflated) world-space camera box — cull to it; absent = emit every sprite. */
  readonly viewport?: Viewport | undefined;
  /** The map's terrain-height field; absent/flat = no lift. */
  readonly elevation?: ElevationField | undefined;
  /** Entities the retained static map-object layer draws instead (skipped entirely). */
  readonly staticRefs?: ReadonlySet<number> | undefined;
  /** The fog-of-war cull (`data/fog.ts` over the viewer's `FogView`); absent = no fog. */
  readonly fogVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** The viewer's remembered statics (`data/fog-ghosts.ts`), drawn dimmed on explored ground. */
  readonly ghosts?: readonly FogGhost[] | undefined;
  /**
   * Keep settlers that are inside a building — mid-exchange in a completed store, or waiting in their
   * workplace between chores (the sim `Resting` marker) — forced to the `idle` standing pose. The map
   * hides these (observed original: off-duty workers wait in the house, not lined up at the door); the
   * details panel's worker field sets this so a bound worker who stepped inside still shows there.
   */
  readonly keepIndoorSettlers?: boolean;
}

/**
 * The depth-sorted sprite draw list alone (no terrain) — the per-frame half the retained
 * {@link import('../../gpu/world-renderer.js').WorldRenderer} consumes. Terrain is static and built once
 * (`setTerrain`), so only moving/animated entities flow through here. Pass a `viewport` to cull to what
 * the camera frames (an item is kept iff its screen anchor is inside the already margin-inflated box);
 * culling changes which items are emitted, never their relative order, so the retained pool and
 * depth-sort stay correct. Absent a viewport, every sprite is emitted.
 */
export function buildSpriteScene(snapshot: WorldSnapshot, opts: SpriteSceneOptions = {}): DrawItem[] {
  return collectSpriteScene(snapshot, opts).items;
}

/**
 * Build the depth-sorted sprite draw list and the pre-cull liveness set in one pass over the snapshot's
 * entities — the shared core of {@link import('./terrain-scene.js').buildScene}, {@link buildSpriteScene}
 * and the retained pool's per-frame reconcile, which needs both and would otherwise classify every entity
 * twice per frame. Each drawable entity is projected to its feet anchor and tagged with the render-side
 * reads (state/facing/carrying/atomic/buildingType) a per-kind binding needs; the per-kind reads run only
 * for items that survive the cull. Sorted by feet anchor `(y, x)` then entity id — a total, stable order,
 * so culling only removes items without reshuffling the survivors.
 *
 * `staticRefs` names entities the retained static map-object layer draws instead (a decoded map's virgin
 * resource nodes): skipped entirely — no draw item, not in the liveness set — so the pool runs no
 * per-frame work for scenery that has its own built-once quad.
 *
 * `fogVisible` is the fog-of-war cull (`data/fog.ts` over the viewer's `FogView`): an entity whose tile
 * it rejects is treated like a viewport-culled one — kept in the liveness set so its pooled sprite
 * survives until the fog lifts, but emitting no draw item.
 *
 * `ghosts` are the viewer's remembered statics (`data/fog-ghosts.ts`, pre-filtered to explored ground by
 * the store): each projects like a live static (same anchor, lift and depth formula, so a ghost occludes
 * correctly against live sprites at the fog boundary) but is tagged {@link DrawItem.ghost} for the pool's
 * grey tint. Ghost refs join the liveness set, keeping a dead entity's pooled sprite alive for as long as
 * the memory draws. A ref never yields two items: the store deletes records on visible ground, and the fog
 * cull drops live items elsewhere.
 */
export function collectSpriteScene(snapshot: WorldSnapshot, opts: SpriteSceneOptions = {}): SpriteScene {
  const { viewport, elevation, staticRefs, fogVisible, ghosts, keepIndoorSettlers } = opts;
  const items: MutableDrawItem[] = [];
  const liveRefs = new Set<number>();
  // Target positions for facing mid-swing actors and aiming projectiles: built once per snapshot and
  // reused across the frames that render it (see targetPositionsOf), empty when no actor needs it.
  const posByRef = targetPositionsOf(snapshot);
  const enterableStores = enterableStoresOf(snapshot);
  for (const entity of snapshot.entities) {
    // Drawn by the retained static layer instead (a virgin map resource); skip before classifying.
    if (staticRefs?.has(entity.id)) continue;
    const components = entity.components;
    const kind = classify(components);
    if (kind === null) continue;
    const pos = readPosition(components);
    if (pos === null) continue;
    // A settler inside a building (mid-exchange in a completed store, or the `Resting` marker in its
    // workplace) stays live/pooled but is not drawn, unless `keepIndoorSettlers` overrides it.
    let indoorSettler = false;
    if (kind === 'settler') {
      const store = readStoreExchangeRef(components);
      indoorSettler = 'Resting' in components || (store !== null && enterableStores.has(store));
      if (indoorSettler && keepIndoorSettlers !== true) {
        liveRefs.add(entity.id);
        continue;
      }
    }
    // A delivery flag is a `stockpile`-kind marker that must paint just above a co-located goods heap of
    // the same kind (both resolve to the same feet anchor). Read here so it folds into the depth key.
    const isFlag = 'DeliveryFlag' in components;
    liveRefs.add(entity.id);
    // Fixed (scaled int) -> float tile coordinate. Render-only; never re-enters the sim.
    const tileX = pos.x / ONE;
    const tileY = pos.y / ONE;
    const screen = tileToScreen(tileX, tileY);
    // Only settlers animate per-state in this slice; a building/resource is always idle. An indoor
    // settler is forced idle so a lingering path/atomic from the tick it stepped inside can't leave it
    // walking or mid-swing in the panel's portrait.
    const state: SpriteState = kind === 'settler' && !indoorSettler ? readSpriteState(components) : 'idle';
    const actingAtomic = kind === 'settler' && !indoorSettler ? readActingAtomic(components) : null;
    // A mid-swing attacker/harvester faces its target but plays the swing in place: the drawn anchor
    // never moves toward the enemy/node. The swing frames carry their own authored advance in the
    // per-frame foot offsets, so any extra positional nudge doubles that motion and reads as the body
    // sliding over the ground at every swing. The axe/blade reach is the art's job.
    let targetFacing: number | undefined;
    if (kind === 'settler' && actingAtomic !== null && TARGET_FACING_ATOMIC_IDS.has(actingAtomic)) {
      const targetRef = readAtomicTargetEntity(components);
      const to = targetRef !== null ? posByRef.get(targetRef) : undefined;
      if (to !== undefined) {
        targetFacing = facingTowardTile({ x: tileX, y: tileY }, { x: to.x / ONE, y: to.y / ONE });
      }
    }
    const drawX = screen.x;
    const drawY = screen.y;
    // Cull to the framed viewport. Uses the drawn anchor; the box is pre-inflated by the renderer to
    // cover a tall sprite's extent, so a building straddling the edge still draws.
    if (viewport !== undefined && !isVisible(viewport, drawX, drawY)) continue;
    // Fog-of-war cull: an entity on ground the viewer does not currently see stays pooled but draws
    // nothing, the same contract as the viewport cull. After the viewport cull on purpose: the fog probe
    // costs a mask lookup per call, so it runs for the few on-screen entities, not the map.
    if (fogVisible !== undefined && !fogVisible(tileX, tileY)) continue;
    // Terrain lift at the feet (bilinear over the elevation lane) is the draw offset, not the depth key:
    // the anchor and `depth` below stay pre-lift so occlusion sorts by map row, not by lifted screen y.
    // A flat map (`maxLift === 0`) skips the sampler entirely.
    const lift = terrainLiftAt(elevation, tileX, tileY);
    // A projectile's ballistic height (set in its branch below) rides the same lift channel as terrain:
    // a pure draw offset the depth key never sees, so the lob can't reshuffle occlusion mid-flight.
    let arcLift = 0;
    const item: MutableDrawItem = {
      kind,
      ref: entity.id,
      x: drawX,
      y: drawY,
      // Feet-anchor depth: lower (greater y), then further-right (greater x), then a per-kind sub-cell
      // bias (a settler in front of the node it stands on, a flag in front of its ground drops — plus a
      // half-step so a flag out-sorts a co-located heap of its own kind), then id. A total order, so the
      // sort is deterministic regardless of snapshot iteration order.
      depth: spriteDepth(tileX, tileY, kind, isFlag),
      state,
    };
    // Per-kind reads, assigned (not spread) so an absent fact stays an absent property under
    // exactOptionalPropertyTypes without a throwaway spread object per field.
    if (kind === 'settler') {
      assignSettlerFields(item, components, actingAtomic, targetFacing);
    } else if (kind === 'building') {
      // A building carries its type id (the `[GfxHouse]` `LogicType` → `GfxBobId` join a per-type binding
      // draws its house bob by) and, while under construction, its progress percent (the stage binding
      // picks the visible layers: grey foundation → stages → body).
      assignStaticFields(item, 'building', components);
      // Mid production cycle: the switch a type's animated state overlay flips on (the mill's rotor).
      // Live-only, since a fog ghost never animates.
      if (readProducing(components)) item.working = true;
    } else if (kind === 'resource') {
      // A resource node carries its `goodType` (per-good species/deposit), its shrink-by-`level` fill, and
      // its source-variant `gfxIndex` ("pine 02", not the representative "yew 01") — via the shared static
      // reader so a live node and its fog ghost read the same fields.
      assignStaticFields(item, 'resource', components);
      // The ladder denominator rides alongside `level` so the resolver can rescale the sim's ladder onto
      // the bound record's own state count. Live-only: ghosts omit it (see assignStaticFields).
      if (item.level !== undefined) {
        const levels = readResourceLevelCount(components);
        if (levels !== undefined) item.levels = levels;
      }
    } else if (kind === 'stump') {
      assignStaticFields(item, 'stump', components);
    } else if (kind === 'berrybush') {
      // A berry bush carries its render-variant `gfxIndex` (the fruited-bush record, i.e. its species) and
      // a ripe/bare level (2 = fruited, 1 = bare), so its per-variant two-frame binding draws the state
      // the sim last set (foraged → bare, regrown → ripe).
      const gfxIndex = readBerryBushGfxIndex(components);
      if (gfxIndex !== undefined) item.gfxIndex = gfxIndex;
      const level = readBerryBushLevel(components);
      if (level !== undefined) item.level = level;
    } else if (kind === 'projectile') {
      // Rides the lift draw channel, like terrain lift — never the depth key (see assignProjectileArc).
      arcLift = assignProjectileArc(item, components, screen, posByRef);
    } else {
      // stockpile | grounddrop: both read their held good and fill from the stockpile — the trunk keys its
      // per-good pickup graphic off `goodType`, the flag/heap its per-fill frame off `goodType`+`fill`.
      const { goodType, fill } = readStockpile(components);
      if (goodType !== undefined) item.goodType = goodType;
      if (fill !== undefined) item.fill = fill;
      // A designated delivery flag draws the flag graphic and is painted above a co-located heap (the
      // depth key already carries the FLAG_PAINT_STEP bump; this just tags the item for the resolver).
      if (isFlag) item.isFlag = true;
    }
    const drawLift = lift + arcLift;
    if (drawLift !== 0) item.lift = drawLift;
    items.push(item);
  }
  if (ghosts !== undefined) pushGhostItems(items, liveRefs, ghosts, viewport, elevation);
  // Stable, total order: sprites by (y, x, id). The entity-id tie-break makes two sprites on the exact
  // same tile order deterministically.
  items.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return { items, liveRefs };
}
