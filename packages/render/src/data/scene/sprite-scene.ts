import type { WorldSnapshot } from '@vinland/sim';
import type { ElevationField } from '../elevation.js';
import { ONE, tileToScreen } from '../iso.js';
import { isVisible, type Viewport } from '../viewport.js';
import {
  type DrawItem,
  FLAG_PAINT_STEP,
  type MutableDrawItem,
  SPRITE_PAINT_ORDER,
  type SpriteState,
} from './draw-item.js';
import {
  classify,
  facingTowardTile,
  readActingAtomic,
  readAtomicElapsed,
  readAtomicTargetEntity,
  readBerryBushGfxIndex,
  readBerryBushLevel,
  readBuildingType,
  readBuiltPct,
  readCarrying,
  readEngaged,
  readEquipmentWeaponGood,
  readFacing,
  readJobType,
  readOwnerPlayer,
  readPosition,
  readProjectileOrigin,
  readProjectileTarget,
  readResourceGfxIndex,
  readResourceGood,
  readResourceLevel,
  readResourceLevelCount,
  readSpriteState,
  readStockpile,
  readStoreExchangeRef,
  readStumpGood,
} from './snapshot-readers.js';

/**
 * The PURE sprite-scene builder — the per-frame half of the scene layer, and the part of rendering an
 * agent CAN self-verify. It turns a {@link WorldSnapshot} into a flat, **depth-sorted** list of sprite
 * draw items in isometric screen space (no Pixi, no canvas, no GPU: plain data the GPU layer walks in
 * order), plus the pre-cull liveness set the retained pool reconciles against. The per-component
 * snapshot reads live in {@link import('./snapshot-readers.js')}; this module owns the projection,
 * the cull, and the depth order.
 *
 * Why floats are fine here: this is `render`, a pure consumer of sim state (docs/ARCHITECTURE.md).
 * The sim stays fixed-point; render reads the snapshot's `Fixed` position (a scaled integer) and
 * divides by ONE to a float tile coordinate. Nothing here feeds back into the sim.
 */

/**
 * Sprite depth packing. A sprite's sort key is `tileY * ROW_STRIDE + tileX`, so the integer-tile
 * `y` dominates and `x` orders within a row — valid only while `tileX < ROW_STRIDE`, which holds for
 * any sane map (sim positions stay well under ~2^25 tiles; real maps are a few hundred). Terrain tiles
 * sit in a band shifted strictly below every sprite (see {@link import('./terrain-scene.js')}).
 */
export const ROW_STRIDE = 4096;

/** Depth added per {@link SPRITE_PAINT_ORDER} step in the oracle sort key. `< 1 / maxOrder` so the whole
 *  bias stays under one tile-column (base depths differ by ≥ 1 across cells) and can't cross a cell. */
const PAINT_ORDER_EPS = 1 / 16;

/**
 * The atomic id of a combat attack swing — the original's `setatomic <job> 81 "..._attack"` (id 81 is
 * the attack slot across every fighting job; the sim's `ATTACK_ATOMIC_ID`, `systems/conflict/weapons.ts`).
 * A settler mid-attack has stopped moving, so it has no {@link readFacing} heading; it FACES its target
 * instead (the attacker→target screen step). The same numeric contract as the sim, transcribed here (like
 * {@link TARGET_FACING_ATOMIC_IDS}) rather than imported — render reads the snapshot's plain ids, never sim code.
 */
const ATTACK_ATOMIC_ID = 81;

/** The per-good harvest atomic ids (`goodtypes.ini` `atomicForHarvesting`), transcribed by hand like
 *  {@link ATTACK_ATOMIC_ID} — the shared numeric contract, named so no bare id carries the meaning. */
const HARVEST_ATOMIC_IDS = {
  wood: 24,
  stone: 25,
  clay: 26,
  iron: 27,
  gold: 28,
  wheat: 29,
  mushroom: 32,
} as const;

/**
 * Every atomic whose runner FACES its {@link readAtomicTargetEntity} target while the swing plays: the
 * combat attack plus the per-good harvest actions ({@link HARVEST_ATOMIC_IDS}). A harvester, like an
 * attacker, has stopped walking (no {@link readFacing} heading), so without a target-derived facing it
 * kept its last walk heading (or the default SE) and swung its axe/pick into empty air BESIDE the node
 * it works — a woodcutter standing east of a tree chopped further east. Facing the node it targets is
 * what the original does (`atomicanimations.ini` even carries `startdirection` pins for a subset).
 */
const TARGET_FACING_ATOMIC_IDS: ReadonlySet<number> = new Set([
  ATTACK_ATOMIC_ID,
  ...Object.values(HARVEST_ATOMIC_IDS),
]);

/**
 * Ballistic-arc shape of a drawn projectile: the lob's PEAK height is this fraction of the shot's total
 * origin→target screen distance, capped at {@link PROJECTILE_ARC_PEAK_MAX_PX} so a max-range longbow
 * shot (23 tiles — up to ~1560 px on an east–west chord at 68 px/cell) doesn't leave the screen. The sim
 * flight is a straight homing step (its own named approximation); the arc is render-only — height
 * `4·peak·p·(1−p)` over the fraction flown `p`, zero at both the bow and the impact. Observed original
 * behaviour (arrows visibly lob); tunable by eye (both exported so the tests pin the formula, not a copy
 * of today's tuning).
 */
export const PROJECTILE_ARC_PEAK_FRACTION = 0.12;
/** Cap on the lob's peak height (screen px) — see {@link PROJECTILE_ARC_PEAK_FRACTION}. */
export const PROJECTILE_ARC_PEAK_MAX_PX = 56;

/** Optional tweaks to the sprite-scene projection. The map/live path passes nothing and behaves exactly
 *  as before; today the only knob is the details panel's "show a building's indoor occupants" override. */
export interface SpriteSceneOptions {
  /**
   * Keep settlers that are INSIDE a building — mid-exchange in a completed store, or waiting in their
   * workplace between chores (the sim `Resting` marker) — instead of suppressing them, forced to the
   * `idle` standing pose. The map hides these (the original's off-duty workers wait in the house, not
   * lined up at the door); the details panel's worker field sets this so a bound worker who has stepped
   * inside STANDS in the panel rather than vanishing from it.
   */
  readonly keepIndoorSettlers?: boolean;
}

/** One frame's sprite scene: the culled, depth-sorted draw list PLUS the pre-cull liveness set —
 *  produced in a single pass over the snapshot (see {@link collectSpriteScene}). */
export interface SpriteScene {
  readonly items: DrawItem[];
  /** Ids of ALL drawable entities (before the cull) — the set the retained pool reconciles against
   *  (an id missing here has DIED; one present but not in {@link items} is merely off-screen). */
  readonly liveRefs: ReadonlySet<number>;
}

/**
 * The depth-sorted SPRITE draw list alone (no terrain) — the per-frame half the retained
 * {@link import('../../gpu/world-renderer.js').WorldRenderer} consumes. Terrain is static and built ONCE
 * (`setTerrain`), so it no longer flows through the per-frame path; this emits only the
 * moving/animated entities. Pass a `viewport` to CULL to what the camera frames (an item is kept iff
 * its screen anchor is inside the — already margin-inflated — box); culling changes *which* items are
 * emitted, never their relative order, so the retained pool + depth-sort stay correct. Absent a
 * viewport, every sprite is emitted (the whole-map / fully-zoomed-out case). Pure.
 */
export function buildSpriteScene(
  snapshot: WorldSnapshot,
  viewport?: Viewport,
  elevation?: ElevationField,
  staticRefs?: ReadonlySet<number>,
  fogVisible?: (tileX: number, tileY: number) => boolean,
  options?: SpriteSceneOptions,
): DrawItem[] {
  return collectSpriteScene(snapshot, viewport, elevation, staticRefs, fogVisible, options).items;
}

/**
 * The set of entity ids that draw as a sprite (a drawable marker + a Position) — the liveness set the
 * retained pool reconciles against to DESTROY sprites of entities that have left the snapshot (died),
 * as distinct from ones merely culled off-screen (still live, kept in the pool). A thin view over
 * {@link collectSpriteScene} so the liveness policy has ONE owner (the pool's per-frame path reads the
 * same set from the combined pass instead of calling this). Pure.
 */
export function drawableEntityRefs(snapshot: WorldSnapshot): ReadonlySet<number> {
  return collectSpriteScene(snapshot).liveRefs;
}

/** Per-snapshot memo of {@link enterableStoresOf} — the set is a pure function of the snapshot, and
 *  {@link collectSpriteScene} runs per FRAME while the snapshot changes per TICK, so rebuilding it
 *  each frame was a second full entity pass against the function's own one-pass rule. */
const enterableStoresBySnapshot = new WeakMap<WorldSnapshot, ReadonlySet<number>>();

/**
 * COMPLETED buildings (built, not a construction site) — the "enterable store" set. A settler whose
 * running atomic exchanges goods with one of these (a pileup deposit / a pickup lift) is NOT drawn:
 * the original's carrier walks INTO the house and vanishes for the exchange (observed), so hiding it
 * for the atomic's duration reads as entering, instead of a deposit pantomimed at the door. A ground
 * pile / flag / construction site is not enterable — those exchanges keep their animation.
 */
function enterableStoresOf(snapshot: WorldSnapshot): ReadonlySet<number> {
  const cached = enterableStoresBySnapshot.get(snapshot);
  if (cached !== undefined) return cached;
  const stores = new Set<number>();
  for (const entity of snapshot.entities) {
    if ('Building' in entity.components && readBuiltPct(entity.components) === undefined) {
      stores.add(entity.id);
    }
  }
  enterableStoresBySnapshot.set(snapshot, stores);
  return stores;
}

/**
 * Build the depth-sorted sprite draw list AND the pre-cull liveness set in one pass over the
 * snapshot's entities — the shared core of {@link import('./terrain-scene.js').buildScene},
 * {@link buildSpriteScene} and the retained pool's per-frame reconcile (which needs both and would
 * otherwise classify every entity twice per frame). Each drawable entity is projected to its feet
 * anchor and tagged with the render-side reads (state/facing/carrying/atomic/buildingType) a per-kind
 * binding needs; when a `viewport` is given, one whose drawn anchor falls outside the framed box is
 * dropped — the per-kind reads run only for the items that survive the cull. Sorted by feet anchor
 * `(y, x)` then entity id — a total, stable order, so culling only removes items without reshuffling
 * the survivors. Pure.
 *
 * `staticRefs` names entities the RETAINED static map-object layer draws instead (a decoded map's
 * virgin resource nodes — see the `?map=` entry's handover): they are skipped entirely — no draw item,
 * not in the liveness set — so the pool never runs per-frame work for scenery that has its own
 * built-once quad (golden rule: per-frame cost tracks the screen's ACTIVE entities, not the forest).
 *
 * `fogVisible` is the fog-of-war cull (`data/fog.ts` over the viewer's `FogView`): an entity whose
 * tile it rejects is treated exactly like a viewport-culled one — kept in the liveness set (still
 * alive, its pooled sprite is retained for when the fog lifts) but emits no draw item, so a unit,
 * building, resource or pile in unexplored/grey ground simply does not draw.
 */
export function collectSpriteScene(
  snapshot: WorldSnapshot,
  viewport?: Viewport,
  elevation?: ElevationField,
  staticRefs?: ReadonlySet<number>,
  fogVisible?: (tileX: number, tileY: number) => boolean,
  options?: SpriteSceneOptions,
): SpriteScene {
  const items: MutableDrawItem[] = [];
  const liveRefs = new Set<number>();
  // A mid-swing attacker/harvester faces — and an in-flight projectile points at — its target's LIVE
  // position, which needs random access by id (a target may be off-screen / culled, and `WorldSnapshot`
  // carries no id index). Build that index ONLY on a frame that has such an actor — a cheap early-exit
  // scan decides — so a scene with nobody working or fighting never pays for it. It stores the
  // snapshot's own Position object (readPosition returns it, not a copy), so the fill is N Map.sets with
  // NO per-entity allocation/divide; the `/ONE` to tile space is deferred to the rare facing lookups below.
  let needsPosIndex = false;
  for (const entity of snapshot.entities) {
    const acting = readActingAtomic(entity.components);
    if ((acting !== null && TARGET_FACING_ATOMIC_IDS.has(acting)) || 'Projectile' in entity.components) {
      needsPosIndex = true;
      break;
    }
  }
  const posByRef = new Map<number, { x: number; y: number }>();
  if (needsPosIndex) {
    for (const entity of snapshot.entities) {
      const p = readPosition(entity.components);
      if (p !== null) posByRef.set(entity.id, p);
    }
  }
  const enterableStores = enterableStoresOf(snapshot);
  for (const entity of snapshot.entities) {
    // Drawn by the retained static layer instead (a virgin map resource) — skip before even classifying.
    if (staticRefs?.has(entity.id)) continue;
    const components = entity.components;
    const kind = classify(components);
    if (kind === null) continue;
    const pos = readPosition(components);
    if (pos === null) continue;
    // A settler mid-exchange INSIDE a completed building store — or WAITING INSIDE its workplace
    // between chores (the sim `Resting` marker): live (pooled) but not drawn. The original's off-duty
    // workers wait in the house, not lined up at the door. The details panel overrides this
    // (`keepIndoorSettlers`) to show a building's occupants in its worker field; such an indoor settler
    // is forced to the `idle` STANDING pose below (no in-transit gait, no lingering action swing).
    let indoorSettler = false;
    if (kind === 'settler') {
      const store = readStoreExchangeRef(components);
      indoorSettler = 'Resting' in components || (store !== null && enterableStores.has(store));
      if (indoorSettler && options?.keepIndoorSettlers !== true) {
        liveRefs.add(entity.id);
        continue;
      }
    }
    // A delivery flag is a `stockpile`-kind marker that must paint just ABOVE a co-located goods heap of
    // the same kind (both resolve to the same feet anchor). Known here so it folds into the depth key.
    const isFlag = 'DeliveryFlag' in components;
    liveRefs.add(entity.id);
    // Fixed (scaled int) -> float tile coordinate. Render-only; never re-enters the sim.
    const tileX = pos.x / ONE;
    const tileY = pos.y / ONE;
    const screen = tileToScreen(tileX, tileY);
    // Only settlers animate per-state in this slice; a building/resource is always idle.
    // An indoor settler (kept only for the panel) stands idle — force it, so a lingering path/atomic
    // from the tick it stepped inside can't leave it walking or mid-swing in the building's portrait.
    const state: SpriteState = kind === 'settler' && !indoorSettler ? readSpriteState(components) : 'idle';
    const actingAtomic = kind === 'settler' && !indoorSettler ? readActingAtomic(components) : null;
    // A mid-swing attacker/harvester FACES its target but plays the swing IN PLACE — the drawn anchor
    // never moves toward the enemy/node. The swing frames carry their own authored advance in the
    // per-frame foot offsets (the figure leans and strikes within the sprite), so any extra positional
    // nudge DOUBLES that motion and reads as the body sliding over the ground at every swing (the
    // reported przód-tył glide — first seen on the attack nudge, then again on the removed chop nudge,
    // which also popped on/off across the between-swings replan gap). The axe/blade reach is the art's job.
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
    // Cull to the framed viewport (when culling). Uses the DRAWN anchor; the box is pre-inflated by the
    // renderer to cover a tall sprite's extent, so a building straddling the edge still draws.
    if (viewport !== undefined && !isVisible(viewport, drawX, drawY)) continue;
    // Fog-of-war cull: an entity on ground the viewer does not currently SEE stays pooled (live) but
    // draws nothing — the same contract as the viewport cull. AFTER the viewport cull on purpose: the
    // fog probe costs a mask lookup per call, so it runs for the few on-screen entities, not the map.
    if (fogVisible !== undefined && !fogVisible(tileX, tileY)) continue;
    // Terrain lift at the feet (bilinear over the elevation lane) — the DRAW offset, NOT the depth key.
    // The anchor/`depth` below stay PRE-LIFT so occlusion sorts by map row, not by lifted screen y.
    // A flat map (`maxLift === 0`) skips the sampler entirely — the elevation-free path stays free.
    const lift = elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAt(tileX, tileY) : 0;
    // A projectile's ballistic height (set in its branch below) rides the SAME lift channel as terrain:
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
      // sort is deterministic regardless of snapshot iteration nuances.
      depth:
        tileY * ROW_STRIDE +
        tileX +
        (SPRITE_PAINT_ORDER[kind] + (isFlag ? FLAG_PAINT_STEP : 0)) * PAINT_ORDER_EPS,
      state,
    };
    // Per-kind reads, ASSIGNED (not spread) so an absent fact stays an absent property under
    // exactOptionalPropertyTypes without a throwaway spread object per field.
    if (kind === 'settler') {
      if (actingAtomic !== null) {
        item.atomicId = actingAtomic;
        // The action clock rides ALONGSIDE the atomic — omitted when idle (see DrawItem.elapsed), so a
        // kept-indoor settler that still holds a stale CurrentAtomic doesn't carry an orphan elapsed.
        const elapsed = readAtomicElapsed(components);
        if (elapsed !== null) item.elapsed = elapsed;
      }
      // A combat-engaged unit reads the readied `..._agressive` gait (the sim `Engagement` marker).
      if (readEngaged(components)) item.engaged = true;
      // Facing: a mid-attack/mid-harvest swing has no walking heading, so it faces its target's LIVE
      // tile (resolved above); otherwise the movement heading. Target facing WINS when it resolves,
      // so a stale path can't leave an attacker or a woodcutter swinging at empty air.
      const facing = targetFacing ?? readFacing(components);
      if (facing !== undefined) item.facing = facing;
      const carrying = readCarrying(components);
      if (carrying !== null) {
        item.carrying = true;
        if (carrying.goodType !== undefined) item.carryGood = carrying.goodType;
      }
      const jobType = readJobType(components);
      if (jobType !== undefined) item.jobType = jobType;
      // The equipped weapon good drives the drawn warrior look (bow slot → bow body) over the jobType.
      const weaponGood = readEquipmentWeaponGood(components);
      if (weaponGood !== undefined) item.weaponGood = weaponGood;
      const player = readOwnerPlayer(components);
      if (player !== undefined) item.player = player;
      // Only a born-young settler carries `Age` — the component-presence disambiguation of the age-class
      // jobType ids (1..4) from colliding synthetic adult ids (AGENTS.md [dc3ef54]).
      if ('Age' in components) item.young = true;
    } else if (kind === 'building') {
      // A building carries its type id so a per-type binding draws its own house bob (the `[GfxHouse]`
      // `LogicType` → `GfxBobId` join), and — while under construction — its progress percent so the
      // construction-stage binding can pick the visible layers (grey foundation → stages → body).
      const typeId = readBuildingType(components);
      if (typeId !== undefined) item.typeId = typeId;
      const builtPct = readBuiltPct(components);
      if (builtPct !== undefined) item.builtPct = builtPct;
    } else if (kind === 'resource') {
      // A resource node carries its `Resource.goodType` so a per-good binding draws its own
      // species/deposit; a MINED node also carries its shrink-by-level fill state so its deposit graphic
      // steps down as it empties (a plain tree/mushroom/full deposit reads no level → full-state frame).
      const goodType = readResourceGood(components);
      if (goodType !== undefined) item.goodType = goodType;
      const level = readResourceLevel(components);
      if (level !== undefined) {
        item.level = level;
        const levels = readResourceLevelCount(components);
        if (levels !== undefined) item.levels = levels;
      }
      // Its exact source variant record ("pine 02", not the representative "yew 01") — a per-variant
      // binding entry wins over the per-good one, so a decoded map keeps its original species variety.
      const gfxIndex = readResourceGfxIndex(components);
      if (gfxIndex !== undefined) item.gfxIndex = gfxIndex;
    } else if (kind === 'stump') {
      const goodType = readStumpGood(components);
      if (goodType !== undefined) item.goodType = goodType;
    } else if (kind === 'berrybush') {
      // A berry bush carries its render-variant `gfxIndex` (the fruited-bush record — its species) and a
      // ripe/bare LEVEL (2 = fruited, 1 = bare), so its per-variant two-frame binding draws the state the
      // sim last set (foraged → bare, regrown → ripe).
      const gfxIndex = readBerryBushGfxIndex(components);
      if (gfxIndex !== undefined) item.gfxIndex = gfxIndex;
      const level = readBerryBushLevel(components);
      if (level !== undefined) item.level = level;
    } else if (kind === 'projectile') {
      // Point the drawn arrow along its flight, and LOB it: the sim advances the shot on a straight
      // homing line, so the drawn arc is pure presentation — the fraction flown `p` along the
      // origin→target chord sets a parabolic height `4·peak·p·(1−p)` (rides `arcLift`, a draw offset
      // like terrain lift, never the depth key) and tilts the rotation along the arc's TANGENT (nose up
      // while climbing, down while falling). A shot whose target vanished this frame keeps rotation
      // unset and flies flat for the one tick the sim takes to expire it — never a throw.
      const targetRef = readProjectileTarget(components);
      const to = targetRef !== null ? posByRef.get(targetRef) : undefined;
      if (to !== undefined) {
        const targetScreen = tileToScreen(to.x / ONE, to.y / ONE);
        const dx = targetScreen.x - screen.x;
        const dy = targetScreen.y - screen.y;
        let rotation = Math.atan2(dy, dx);
        const origin = readProjectileOrigin(components);
        if (origin !== null) {
          const originScreen = tileToScreen(origin.x / ONE, origin.y / ONE);
          const chord = Math.hypot(targetScreen.x - originScreen.x, targetScreen.y - originScreen.y);
          const remaining = Math.hypot(dx, dy);
          if (chord > 0 && remaining > 0) {
            // Homing can stretch the path past the launch chord (the target moves), so clamp p to [0,1].
            const p = Math.min(1, Math.max(0, 1 - remaining / chord));
            const peak = Math.min(chord * PROJECTILE_ARC_PEAK_FRACTION, PROJECTILE_ARC_PEAK_MAX_PX);
            arcLift = 4 * peak * p * (1 - p);
            // Tangent: the straight-line unit heading, sheared by the arc's slope dh/ds (screen-up is -y).
            const slope = (4 * peak * (1 - 2 * p)) / chord;
            rotation = Math.atan2(dy / remaining - slope, dx / remaining);
          }
        }
        item.rotation = rotation;
      }
    } else {
      // stockpile | grounddrop: both read their held good + fill from the stockpile — the trunk keys its
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
  // Stable, total order: sprites by (y, x, id). The entity-id tie-break makes two sprites on the exact
  // same tile order deterministically.
  items.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return { items, liveRefs };
}
