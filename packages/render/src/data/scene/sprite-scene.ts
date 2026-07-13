import type { WorldSnapshot } from '@vinland/sim';
import { type ElevationField, terrainLiftAt } from '../elevation.js';
import type { FogGhost } from '../fog-ghosts.js';
import { ONE, tileToScreen } from '../iso.js';
import { isVisible, type Viewport } from '../viewport.js';
import {
  type DrawItem,
  type DrawKind,
  type MutableDrawItem,
  paintOrderBias,
  type SpriteState,
} from './draw-item.js';
import { projectileArc } from './projectile-arc.js';
import {
  assignStaticFields,
  classify,
  facingTowardTile,
  readActingAtomic,
  readAtomicElapsed,
  readAtomicTargetEntity,
  readBerryBushGfxIndex,
  readBerryBushLevel,
  readBuiltPct,
  readCarrying,
  readEngaged,
  readEquipmentWeaponGood,
  readFacing,
  readJobType,
  readOwnerPlayer,
  readPosition,
  readProducing,
  readProjectileOrigin,
  readProjectileTarget,
  readResourceLevelCount,
  readSpriteState,
  readStockpile,
  readStoreExchangeRef,
} from './snapshot-readers/index.js';

/**
 * The PURE sprite-scene builder — the per-frame half of the scene layer, and the part of rendering an
 * agent CAN self-verify. It turns a {@link WorldSnapshot} into a flat, **depth-sorted** list of sprite
 * draw items in isometric screen space (no Pixi, no canvas, no GPU: plain data the GPU layer walks in
 * order), plus the pre-cull liveness set the retained pool reconciles against. The per-component
 * snapshot reads live in {@link import('./snapshot-readers/index.js')}; this module owns the projection,
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
const ROW_STRIDE = 4096;

/** Depth added per {@link paintOrderBias} step in the oracle sort key. `< 1 / maxOrder` so the whole
 *  bias stays under one tile-column (base depths differ by ≥ 1 across cells) and can't cross a cell. */
const PAINT_ORDER_EPS = 1 / 16;

/** The oracle depth key for a sprite at integer-tile `(tileX, tileY)` (x-first, like `tileToScreen`):
 *  the row-major feet-anchor packing (`tileY` dominates, `tileX` orders within a row) plus the sub-cell
 *  {@link paintOrderBias} tiebreak. The live painter's screen-space twin (`sprite-pool.ts`) shares the
 *  same {@link paintOrderBias}, so the two orders can't diverge. */
function spriteDepth(tileX: number, tileY: number, kind: DrawKind, isFlag = false): number {
  return tileY * ROW_STRIDE + tileX + paintOrderBias(kind, isFlag) * PAINT_ORDER_EPS;
}

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

/** One frame's sprite scene: the culled, depth-sorted draw list PLUS the pre-cull liveness set —
 *  produced in a single pass over the snapshot (see {@link collectSpriteScene}). */
export interface SpriteScene {
  readonly items: DrawItem[];
  /** Ids of ALL drawable entities (before the cull) — the set the retained pool reconciles against
   *  (an id missing here has DIED; one present but not in {@link items} is merely off-screen). */
  readonly liveRefs: ReadonlySet<number>;
}

/** The optional inputs of a scene build — one named shape instead of a positional-parameter tail
 *  (call sites were reading `(snap, undefined, undefined, undefined, undefined, ghosts)`). Every
 *  field accepts an explicit `undefined` so callers can pass through their own optionals directly. */
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
   * Keep settlers that are INSIDE a building — mid-exchange in a completed store, or waiting in their
   * workplace between chores (the sim `Resting` marker) — instead of suppressing them, forced to the
   * `idle` standing pose. The map hides these (the original's off-duty workers wait in the house, not
   * lined up at the door); the details panel's worker field sets this so a bound worker who has stepped
   * inside STANDS in the panel rather than vanishing from it.
   */
  readonly keepIndoorSettlers?: boolean;
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
export function buildSpriteScene(snapshot: WorldSnapshot, opts: SpriteSceneOptions = {}): DrawItem[] {
  return collectSpriteScene(snapshot, opts).items;
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

/** The shared empty index for a snapshot with no target-facing actor — memoized like a real index so a
 *  quiet scene allocates nothing and every frame reuses this one map. */
const EMPTY_POS_INDEX: ReadonlyMap<number, { x: number; y: number }> = new Map();

/** Per-snapshot memo of {@link targetPositionsOf} — same per-frame-vs-per-tick argument as
 *  {@link enterableStoresBySnapshot}. */
const targetPosBySnapshot = new WeakMap<WorldSnapshot, ReadonlyMap<number, { x: number; y: number }>>();

/**
 * The `entity id → live Position` index used to FACE a mid-swing attacker/harvester at its target and to
 * aim an in-flight projectile — random access by id that `WorldSnapshot` carries no structure for. Built
 * ONLY for a snapshot that actually has such an actor (a cheap early-exit scan decides; a scene with
 * nobody working, fighting or shooting memoizes the shared empty index and does no per-entity work), and
 * memoized per snapshot: {@link collectSpriteScene} runs per FRAME while the snapshot changes per TICK, so
 * both the scan and the fill happen once per tick, not once per frame. Stores the snapshot's OWN Position
 * object (readPosition returns it, not a copy), so the fill is N `Map.set`s with NO per-entity
 * allocation/divide; the `/ONE` to tile space is deferred to the rare facing lookups. Pure.
 */
function targetPositionsOf(snapshot: WorldSnapshot): ReadonlyMap<number, { x: number; y: number }> {
  const cached = targetPosBySnapshot.get(snapshot);
  if (cached !== undefined) return cached;
  let needed = false;
  for (const entity of snapshot.entities) {
    const acting = readActingAtomic(entity.components);
    if ((acting !== null && TARGET_FACING_ATOMIC_IDS.has(acting)) || 'Projectile' in entity.components) {
      needed = true;
      break;
    }
  }
  let index: ReadonlyMap<number, { x: number; y: number }> = EMPTY_POS_INDEX;
  if (needed) {
    const byRef = new Map<number, { x: number; y: number }>();
    for (const entity of snapshot.entities) {
      const p = readPosition(entity.components);
      if (p !== null) byRef.set(entity.id, p);
    }
    index = byRef;
  }
  targetPosBySnapshot.set(snapshot, index);
  return index;
}

/**
 * Tag a settler draw item with the render-side reads a per-character binding needs: the running atomic
 * (+ its elapsed clock), the combat-engaged gait flag, the drawn facing (target-facing wins over the
 * walk heading), the hauled good, the job/weapon look, the owner player LUT row, and the born-young age
 * flag. Assigned (not spread) so an absent fact stays an absent property under exactOptionalPropertyTypes.
 */
function assignSettlerFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  actingAtomic: number | null,
  targetFacing: number | undefined,
): void {
  if (actingAtomic !== null) {
    item.atomicId = actingAtomic;
    // The action clock rides ALONGSIDE the atomic — omitted when idle (see DrawItem.elapsed), so a
    // kept-indoor settler that still holds a stale CurrentAtomic doesn't carry an orphan elapsed.
    const elapsed = readAtomicElapsed(components);
    if (elapsed !== null) item.elapsed = elapsed;
  }
  // A combat-engaged unit reads the readied `..._agressive` gait (the sim `Engagement` marker).
  if (readEngaged(components)) item.engaged = true;
  // Facing: a mid-attack/mid-harvest swing has no walking heading, so it faces its target's LIVE tile
  // (resolved by the caller); otherwise the movement heading. Target facing WINS when it resolves, so a
  // stale path can't leave an attacker or a woodcutter swinging at empty air.
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
}

/**
 * Point a projectile draw item along its flight and LOB it (the ballistic-arc trig lives in
 * {@link projectileArc}), returning the ballistic HEIGHT to fold into the draw-lift channel (never the
 * depth key, so the lob can't reshuffle occlusion mid-flight). A shot whose target vanished this frame
 * keeps `rotation` unset and flies flat (lift 0) for the one tick the sim takes to expire it.
 */
function assignProjectileArc(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  screen: ReturnType<typeof tileToScreen>,
  posByRef: ReadonlyMap<number, { x: number; y: number }>,
): number {
  const targetRef = readProjectileTarget(components);
  const to = targetRef !== null ? posByRef.get(targetRef) : undefined;
  if (to === undefined) return 0;
  const origin = readProjectileOrigin(components);
  const arc = projectileArc(
    screen,
    tileToScreen(to.x / ONE, to.y / ONE),
    origin === null ? null : tileToScreen(origin.x / ONE, origin.y / ONE),
  );
  item.rotation = arc.rotation;
  return arc.lift;
}

/**
 * Append the viewer's remembered statics (`data/fog-ghosts.ts`, pre-filtered to EXPLORED ground) to the
 * draw list: each projects with the SAME anchor/lift/depth formula as a live static (so a ghost occludes
 * correctly against live sprites at the fog boundary) but is tagged {@link DrawItem.ghost} for the pool's
 * grey tint. Every ghost ref joins `liveRefs` — a ghost of a DEAD entity keeps its pooled sprite alive as
 * long as the memory draws; a camera-culled ghost still counts as live but emits no item.
 */
function pushGhostItems(
  items: MutableDrawItem[],
  liveRefs: Set<number>,
  ghosts: readonly FogGhost[],
  viewport: Viewport | undefined,
  elevation: ElevationField | undefined,
): void {
  for (const g of ghosts) {
    // A ghost keeps its (possibly dead) entity's pooled sprite alive even while camera-culled.
    liveRefs.add(g.ref);
    const screen = tileToScreen(g.tileX, g.tileY);
    if (viewport !== undefined && !isVisible(viewport, screen.x, screen.y)) continue;
    const lift = terrainLiftAt(elevation, g.tileX, g.tileY);
    // Same anchor/depth formula as a live static, so a ghost sorts correctly against live sprites at the
    // fog boundary. Statics are always `idle`; the per-kind fields were frozen at capture.
    const item: MutableDrawItem = {
      kind: g.kind,
      ref: g.ref,
      x: screen.x,
      y: screen.y,
      depth: spriteDepth(g.tileX, g.tileY, g.kind),
      state: 'idle',
      ghost: true,
    };
    if (g.typeId !== undefined) item.typeId = g.typeId;
    if (g.builtPct !== undefined) item.builtPct = g.builtPct;
    if (g.goodType !== undefined) item.goodType = g.goodType;
    if (g.level !== undefined) item.level = g.level;
    if (g.gfxIndex !== undefined) item.gfxIndex = g.gfxIndex;
    if (lift !== 0) item.lift = lift;
    items.push(item);
  }
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
 *
 * `ghosts` are the viewer's remembered statics (`data/fog-ghosts.ts`, pre-filtered to EXPLORED
 * ground by the store): each projects like a live static (same anchor, lift and depth formula, so a
 * ghost occludes correctly against live sprites at the fog boundary) but is tagged {@link
 * DrawItem.ghost} for the pool's grey tint. Ghost refs join the liveness set — a ghost of a DEAD
 * entity must keep its pooled sprite alive for as long as the memory draws. A ref never yields two
 * items: the store deletes records on VISIBLE ground, the fog cull drops live items elsewhere.
 */
export function collectSpriteScene(snapshot: WorldSnapshot, opts: SpriteSceneOptions = {}): SpriteScene {
  const { viewport, elevation, staticRefs, fogVisible, ghosts, keepIndoorSettlers } = opts;
  const items: MutableDrawItem[] = [];
  const liveRefs = new Set<number>();
  // The target-position index (for facing mid-swing actors + aiming projectiles) — built once per
  // snapshot and reused across the frames that render it (see targetPositionsOf), empty when no actor
  // needs it.
  const posByRef = targetPositionsOf(snapshot);
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
      if (indoorSettler && keepIndoorSettlers !== true) {
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
    const lift = terrainLiftAt(elevation, tileX, tileY);
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
      depth: spriteDepth(tileX, tileY, kind, isFlag),
      state,
    };
    // Per-kind reads, ASSIGNED (not spread) so an absent fact stays an absent property under
    // exactOptionalPropertyTypes without a throwaway spread object per field.
    if (kind === 'settler') {
      assignSettlerFields(item, components, actingAtomic, targetFacing);
    } else if (kind === 'building') {
      // A building carries its type id (the `[GfxHouse]` `LogicType` → `GfxBobId` join a per-type binding
      // draws its house bob by) and — while under construction — its progress percent (the stage binding
      // picks the visible layers: grey foundation → stages → body). Both via the shared static reader.
      assignStaticFields(item, 'building', components);
      // Mid production cycle — the switch a type's animated state overlay flips on (the mill's rotor).
      // Live-only: a fog ghost never animates, so this rides here, not in assignStaticFields.
      if (readProducing(components)) item.working = true;
    } else if (kind === 'resource') {
      // A resource node carries its `goodType` (per-good species/deposit), its shrink-by-`level` fill, and
      // its source-variant `gfxIndex` ("pine 02", not the representative "yew 01") — all via the shared
      // static reader so a live node and its fog ghost read the same fields.
      assignStaticFields(item, 'resource', components);
      // The ladder DENOMINATOR rides ALONGSIDE `level` so the resolver can rescale the sim's ladder onto
      // the bound record's own state count. Live-only: ghosts omit it (see assignStaticFields).
      if (item.level !== undefined) {
        const levels = readResourceLevelCount(components);
        if (levels !== undefined) item.levels = levels;
      }
    } else if (kind === 'stump') {
      assignStaticFields(item, 'stump', components);
    } else if (kind === 'berrybush') {
      // A berry bush carries its render-variant `gfxIndex` (the fruited-bush record — its species) and a
      // ripe/bare LEVEL (2 = fruited, 1 = bare), so its per-variant two-frame binding draws the state the
      // sim last set (foraged → bare, regrown → ripe).
      const gfxIndex = readBerryBushGfxIndex(components);
      if (gfxIndex !== undefined) item.gfxIndex = gfxIndex;
      const level = readBerryBushLevel(components);
      if (level !== undefined) item.level = level;
    } else if (kind === 'projectile') {
      // Rides the lift draw channel, like terrain lift — never the depth key (see assignProjectileArc).
      arcLift = assignProjectileArc(item, components, screen, posByRef);
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
  if (ghosts !== undefined) pushGhostItems(items, liveRefs, ghosts, viewport, elevation);
  // Stable, total order: sprites by (y, x, id). The entity-id tie-break makes two sprites on the exact
  // same tile order deterministically.
  items.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return { items, liveRefs };
}
