import type { BuildingType, Recipe } from '@vinland/data';
import { Building, Position, Settler, Vehicle, stockpileEntries } from '../components/index.js';
import { ONE, fx } from '../core/fixed.js';
import type { Entity, World } from '../ecs/world.js';
import type { CellId, TerrainGraph } from '../nav/terrain.js';
import type { SystemContext } from './context.js';
import { interactionTile, tileKey } from './footprint.js';
import { vehicleMayCarry } from './readviews/vehicles.js';

// The genuinely cross-system helpers, kept in a leaf module so every per-system file imports them
// from here (never from the barrel or from each other) — this breaks the import cycles the
// systems/ split would otherwise create. See docs/TECH-DEBT.md.

/**
 * Ascending entity-id (canonical) ordering of `entities` — the deterministic scan order a system needs
 * when it **picks** an entity (nearest target, first open job): the same order `World.canonicalEntities`
 * uses, so a distance / first-match tie-break lands on the identical winner (goldens unchanged). Build
 * this ONCE per tick from a `world.query(...)` (which is `O(min store)`) and scan the result across all
 * units, instead of each unit re-scanning + re-sorting the whole world — the fix that turns a per-unit
 * full-world scan from `O(units · entities · log n)` into `O(entities + units · matching)`.
 *
 * Determinism note: fed a `world.query(C)` this yields the same ascending-id subsequence the old
 * `canonicalEntities()`-then-filter scan did — but only because the ECS holds `store ⊆ alive` (a
 * component store never keeps a destroyed entity; `destroy()` clears all stores). That invariant is
 * already load-bearing (`query` drives every system loop); a use-after-`destroy` bug would make
 * query-based pickers diverge from `alive`-based ones.
 */
export function canonicalById(entities: Iterable<Entity>): Entity[] {
  return [...entities].sort((a, b) => a - b);
}

/** The empty bucket returned for an unoccupied tile — shared + frozen so a miss allocates nothing. */
const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

// tileKey lives in footprint.ts (the leaf below this one — shared.ts already imports interactionTile
// from it, so defining it there keeps the import graph acyclic); re-exported here so consumers keep
// the established `from './shared.js'` import site.
export { tileKey };

/**
 * A per-tick **spatial bucket**: `entities` grouped by their integer tile, each bucket preserving the
 * input order (feed it a {@link canonicalById} list → ascending-id buckets). Answers "what is on tile
 * (x,y)?" in O(1) via {@link TileBuckets.at}, replacing a full-world scan for on-tile checks (am I
 * standing on a workplace?). By default an entity buckets by its raw {@link Position} tile; an optional
 * `tileOf` resolver overrides that per entity (the JobSystem buckets buildings by their door-aware
 * {@link interactionTile}) — an entity the resolver maps to `null` (and a Position-less one) is dropped.
 * Determinism: a first-match pick over a bucket lands on the same entity a canonical full scan would,
 * because the tile is fixed and the bucket keeps ascending-id order. Rebuilt each tick (derived state,
 * never hashed) — the cheap seam toward a full ring-search grid without touching sim state.
 */
export class TileBuckets {
  private readonly byTile = new Map<string, Entity[]>();

  constructor(
    world: World,
    entities: Iterable<Entity>,
    tileOf?: (e: Entity) => { x: number; y: number } | null,
  ) {
    for (const e of entities) {
      let tile: { x: number; y: number } | null;
      if (tileOf === undefined) {
        const p = world.tryGet(e, Position);
        tile = p === undefined ? null : { x: fx.toInt(p.x), y: fx.toInt(p.y) };
      } else {
        tile = tileOf(e);
      }
      if (tile === null) continue;
      const key = tileKey(tile.x, tile.y);
      let bucket = this.byTile.get(key);
      if (bucket === undefined) {
        bucket = [];
        this.byTile.set(key, bucket);
      }
      bucket.push(e);
    }
  }

  /** The entities on tile (x,y), in ascending-id order — empty (shared) when the tile is unoccupied. */
  at(x: number, y: number): readonly Entity[] {
    return this.byTile.get(tileKey(x, y)) ?? NO_ENTITIES;
  }

  /**
   * The **nearest bucketed entity** to tile `(fromX, fromY)` that satisfies `accept`, searched as
   * expanding Manhattan tile-RINGS from `minDist` outward to `maxDist` — the grid ring search the
   * scaling doctrine (packages/sim/AGENTS.md "Full ring-search nearest-X", ROADMAP tier 3) calls for,
   * so a per-seeker "who's the closest enemy?" query costs O(bounded rings) instead of a full-world
   * scan. Returns the entity + its integer Manhattan distance, or null when nothing in the band matches.
   *
   * The winner is the SAME one a canonical full scan would pick — **(min distance, then min entity
   * id)** — because the search **finishes the whole minimum-distance ring before choosing**: it never
   * stops at the first hit within a ring, it scans every tile of that ring and keeps the smallest id
   * (buckets are ascending-id, and the min is taken across the ring), so the result is independent of
   * the tile-iteration order (determinism). Rings are visited in strictly increasing distance, so the
   * first ring with any accepted entity holds the nearest; the search then returns without touching a
   * farther ring (the short-circuit that makes it cheap), and it stops entirely once `d` passes
   * `maxDist` (an empty query never scans past its radius).
   *
   * `minDist` skips entities nearer than a floor (a ranged weapon's near reach, or excluding the
   * seeker itself at distance 0). The metric is integer tile Manhattan — the exact metric
   * {@link manhattan} measures over cells and the one an entity's bucket tile
   * (`fx.toInt(Position)`) is keyed on — so a ring at distance `d` holds precisely the entities a full
   * scan would score at distance `d`. Determinism: no RNG/wall-clock; a pure ring walk with a min-id
   * tie-break. Reads no world state beyond the pre-bucketed entities — `accept` is the caller's pure
   * per-candidate relation (a hostility test), evaluated at most once per candidate in the band.
   */
  nearest(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
  ): { entity: Entity; distance: number } | null {
    for (let d = minDist; d <= maxDist; d++) {
      let best: Entity | null = null;
      // Ring d = every tile at Manhattan distance EXACTLY d. For each column offset dx in [-d, d] the
      // two rows dy = ±(d - |dx|) complete the diamond (a single row when the remainder is 0, at the
      // ring's E/W tips). The whole ring is scanned before choosing so the min-id pick is canonical.
      for (let dx = -d; dx <= d; dx++) {
        const rem = d - Math.abs(dx);
        best = this.pickMinId(fromX + dx, fromY + rem, accept, best);
        if (rem !== 0) best = this.pickMinId(fromX + dx, fromY - rem, accept, best);
      }
      if (best !== null) return { entity: best, distance: d };
    }
    return null;
  }

  /** The lower-id of `best` and the smallest accepted entity on tile (x,y) — the per-tile step of the
   *  ring search's min-id pick (buckets are ascending-id, so the first accepted entity on a tile is its
   *  smallest, but we still min against `best` across the ring's other tiles). */
  private pickMinId(
    x: number,
    y: number,
    accept: (e: Entity) => boolean,
    best: Entity | null,
  ): Entity | null {
    for (const e of this.at(x, y)) {
      if (!accept(e)) continue;
      // Ascending-id bucket: the first accepted entity is this tile's smallest — take it against the
      // running ring minimum and stop scanning this tile.
      return best === null || e < best ? e : best;
    }
    return best;
  }
}

/**
 * The per-good capacity of a store's stockpile.
 *
 * - An **under-construction building** (a {@link Building} still at `built < ONE` — a construction
 *   site): its per-good ceiling is the material-DELIVERY demand from its building type's `construction`
 *   cost. A good named by the cost gets that cost line's full `amount` (the TOTAL ceiling, like every
 *   other store — callers subtract what's on hand: `nearestStoreFor`'s `have >= capacity` full-check,
 *   `pileup`'s `capacity - have` space); any other good gets 0 (refused). So a site advertises room for
 *   *exactly* its outstanding materials and nothing else — `nearestStoreFor` only delivers a good to a
 *   store with room, so the existing carrier path hauls the `construction` goods to the site (the
 *   `pileup` deposit capped at the outstanding need), and the ConstructionSystem then consumes them and
 *   flips `built`. (An unbuilt building never produces — `productionSystem` gates its start loop on
 *   `built >= ONE` — so this branch's only consumer is the carrier-delivery of build materials; its
 *   stockpile can't be raided to feed a recipe.)
 * - A built **building** store: from its building type's stock slots — a good with no declared slot
 *   has no room (capacity 0). **Plus** an upgradable **built `home`** ({@link homeNextTier} — a `home`
 *   with a next tier in the level chain) also advertises room for its NEXT tier's `construction`
 *   materials: the per-good ceiling is the **larger** of the normal stock-slot capacity and the next
 *   tier's cost-line `amount`, so the same carrier path that delivers a build-site's materials now also
 *   accumulates the upgrade materials at a still-upgradable home (closing the births→housing→upgrade→
 *   more-housing loop with no upgrade-specific transport code). The `constructionSystem` then consumes
 *   them and levels the home up. The top-tier home (no next tier) reverts to its plain stock-slot
 *   capacity, so a maxed home stops attracting materials — exactly like a finished build site.
 * - A **boat hull** ({@link Vehicle}, the "boats as mobile stores" entity — a `Stockpile` on a hull,
 *   not a building): gated by the ship's `cargoGoods` **load allow-list** — a good the hold may carry
 *   ({@link vehicleMayCarry}) gets the whole `stockSlots` hold capacity, a good it may **not** carry
 *   gets 0 (refused, so a carrier never deposits a forbidden good into a boat). This is the *load
 *   half* of "boats as mobile stores": the hull was placed empty (the `placeBoat` command); here a
 *   haul INTO it is filtered by what the vehicle type may hold and bounded by how much. The `stockSlots`
 *   total is applied as a per-good upper bound (a faithful upper bound — the whole-hold-shared-across-
 *   goods cap is a deferred refinement; see docs/FIDELITY.md).
 * - A store with **neither** Building nor Vehicle (a bare test fixture) is treated as uncapped so a
 *   fixture without a type still accepts deposits.
 *
 * Cross-system: used by the AI store scan ({@link nearestStoreFor}), the atomic `pileup` deposit,
 * and production's `canStartCycle`/`depositOutputs`.
 */
export function stockCapacity(world: World, ctx: SystemContext, store: Entity, goodType: number): number {
  const building = world.tryGet(store, Building);
  if (building !== undefined) {
    const type = ctx.content.buildings.find((b) => b.typeId === building.buildingType);
    if (type === undefined) return 0;
    if (building.built < ONE) {
      // Construction site: the per-good ceiling is the building's full `construction` cost for that
      // material (a non-material good gets 0 — refused). Like every store, this is the TOTAL capacity;
      // callers (`nearestStoreFor`'s `have >= capacity` full-check, `pileup`'s `capacity - have` space)
      // subtract what's on hand, so a site advertises room until it holds the whole cost line.
      const line = type.construction.find((c) => c.goodType === goodType);
      return line?.amount ?? 0;
    }
    // Built building: its normal per-good stock-slot ceiling…
    const slot = type.stock.find((s) => s.goodType === goodType);
    const slotCapacity = slot?.capacity ?? 0;
    // …plus, for a built `home` that can still level up, room for the NEXT tier's outstanding
    // construction materials, so the existing carrier path accumulates the upgrade materials at the
    // home. Take the larger of the two ceilings (a good can be both a stocked good and an upgrade
    // material); a maxed-out (top-tier) home has no next tier and keeps only its stock-slot capacity.
    const next = homeNextTier(type, ctx);
    if (next === undefined) return slotCapacity;
    const upgradeLine = next.construction.find((c) => c.goodType === goodType);
    return Math.max(slotCapacity, upgradeLine?.amount ?? 0);
  }
  const hull = world.tryGet(store, Vehicle);
  if (hull !== undefined) {
    const type = ctx.content.vehicles.find((v) => v.typeId === hull.vehicleType);
    if (type === undefined) return 0;
    return vehicleMayCarry(type, goodType) ? type.stockSlots : 0;
  }
  return Number.MAX_SAFE_INTEGER; // bare store fixture: uncapped
}

/** The lowest-id good a stockpile holds ≥1 unit of, or null if it is empty. Canonical (ascending
 *  goodType via {@link stockpileEntries}) so a pick keyed off it never depends on Map insertion order.
 *  The shared building block behind the ground-pile scans (`nearestGroundPile`, the collect-trunk drive). */
export function lowestStockedGood(stock: { amounts: Map<number, number> }): number | null {
  for (const [goodType, amount] of stockpileEntries(stock)) if (amount > 0) return goodType;
  return null;
}

/**
 * The recipe a building's type declares, or undefined if it has no Building/type or no recipe.
 *
 * Cross-system: the AI uses it to recognise a workplace (haul source / never-deliver-back-to-producer),
 * and ProductionSystem uses it to run the cycle.
 */
export function recipeOf(world: World, ctx: SystemContext, building: Entity): Recipe | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  return type?.recipe;
}

/**
 * The set of job types a building type's `workers` slots name (`logicworker <job> <count>`). Empty
 * if the building has no Building/type or declares no workers (an unstaffed-by-design building — a
 * passive store, or any type without worker slots).
 *
 * Cross-system: the production worker-presence gate ({@link workerPresentAt}) uses it to recognise a
 * settler that may operate the workplace, and the AI planner uses it to recognise a settler standing
 * on a workplace it staffs (so the operator isn't re-planned away).
 */
export function buildingWorkerJobs(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_JOBS;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  if (type === undefined || type.workers.length === 0) return EMPTY_JOBS;
  return new Set(type.workers.map((w) => w.jobType));
}

const EMPTY_JOBS: ReadonlySet<number> = new Set<number>();

/**
 * Whether a workplace is staffed *right now*: some {@link Settler} whose `jobType` matches one of the
 * building type's `workers` slots is standing on the workplace's tile. This is the production
 * worker-presence model — a workplace only produces while its worker is present, like the original
 * (a sawmill with no operator makes no planks).
 *
 * A building type that declares **no** worker slots is unstaffed-by-design and counts as always
 * present (passive stores / fixtures without workers keep working) — the gate constrains only a
 * workplace that actually names a worker. Presence is integer-tile coincidence with the building's
 * **interaction tile** (its door cell when the type's footprint names one, else its anchor tile —
 * {@link interactionTile}; the walls themselves are walk-blocked, so an operator works AT the door,
 * exactly where the AI walk-to-station drive delivers it), so it needs no terrain graph and works on
 * a mapless fixture too. The match is canonical-order-independent (a boolean any-match, not a chosen
 * entity), so no determinism concern.
 *
 * Cross-system: ProductionSystem gates both starting and advancing a cycle on this.
 */
export function workerPresentAt(world: World, ctx: SystemContext, building: Entity): boolean {
  const jobs = buildingWorkerJobs(world, ctx, building);
  if (jobs.size === 0) return true; // unstaffed-by-design: no worker requirement to satisfy
  const at = interactionTile(world, ctx, building);
  if (at === null) return false; // a placed-but-position-less workplace can't be stood on
  const bx = at.x;
  const by = at.y;
  for (const e of world.query(Settler, Position)) {
    const settler = world.get(e, Settler);
    if (settler.jobType === null || !jobs.has(settler.jobType)) continue;
    const p = world.get(e, Position);
    if (fx.toInt(p.x) === bx && fx.toInt(p.y) === by) return true;
  }
  return false;
}

/**
 * Whether a good is **edible** — the food a hungry settler consumes to reset its hunger (the `eat`
 * atomic's target good). In the original, the eat slot (`setatomic <job> 10 "..._eat_slot_food"`)
 * consumes the `food_simple`/`food_extra` goods (`goodtypes.ini` types 16/17); there is no explicit
 * "iseatable" flag in `goodtypes.ini`, so the slot-food goods are identified by the good's `id`
 * carrying the `food` prefix (the source's own naming — `food_simple`/`food_extra`). (`potion_food_*`
 * are a separate potion-consumable mechanic, not the eat slot, so the `food_`-prefix match excludes
 * them by construction.)
 *
 * FIDELITY (approximated — see docs/FIDELITY.md): the eat atomic id (10) is pinned to the original's
 * `setatomic` bindings, but *which goods feed* is inferred from the slug rather than a source flag
 * (the original maps the food goods to the eat slot at a level not in the readable rule files). Refine
 * to a content flag if the slot→good binding is later decoded. Cross-system: the AI eat-drive planner
 * uses it to find food (carried or stored); the AtomicSystem consumes one unit on completion.
 */
export function isFood(ctx: SystemContext, goodType: number): boolean {
  const good = ctx.content.goods.find((g) => g.typeId === goodType);
  if (good === undefined) return false;
  return good.id.startsWith('food_');
}

/**
 * The **housing capacity** a `tribe` currently has: the sum of the `homeSize` of its placed, fully
 * **built** `home` buildings. This is the sim's first consumer of the extracted `homeSize` param
 * (the original `logichousetype` `logichomesize` — the population a residence shelters: home level
 * 00 → 1, ... level 04 → 5). It is the ceiling the population grows into — the housing half of the
 * roadmap's `house leveling → population capacity → births→housing→births` loop, the number the
 * ReproductionSystem will gate births on (a tribe can only grow while it has room).
 *
 * Only a **built** residence counts (`built >= ONE`): a home still under construction shelters no
 * one yet (the slice places buildings already built, but the ConstructionSystem will start them at
 * `built = 0`, so the gate is forward-compatible). A `home`-kind building type with no `homeSize`
 * (none in the real data, but the schema defaults it to 0) contributes nothing.
 *
 * FIDELITY: the per-home capacity is the extracted `homeSize` param — faithful by construction; what
 * the capacity *gates* (births) is a later mechanic. Determinism: a pure sum over buildings (addition
 * commutes, so the `query` store order can't change the total — no canonical sort needed); no
 * RNG/wall-clock. A building whose type is absent from content contributes nothing.
 */
export function housingCapacity(world: World, ctx: SystemContext, tribe: number): number {
  let capacity = 0;
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.tribe !== tribe || b.built < ONE) continue; // wrong tribe, or not yet built — shelters no one
    const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
    if (type === undefined || type.kind !== 'home') continue; // not a residence
    capacity += type.homeSize;
  }
  return capacity;
}

/**
 * The next tier in a `home`'s level chain, or undefined if `type` is not a `home` or is the top tier.
 *
 * The home level chain is the consecutive typeIds `home_level_00..04` (typeIds 2..6 in the real data),
 * each a distinct `home`-kind {@link BuildingType} carrying its OWN per-level `construction` cost and a
 * larger `homeSize`. So the next tier is the building type at `typeId + 1`, provided that type exists
 * AND is itself a `home` (the chain is contiguous; the type just past the chain's top, `home_level_04`,
 * is not a home, so a top-tier home has no next tier). Reading the chain off the consecutive typeId
 * keeps the upgrade purely data-driven — there is no separate "next level" pointer in the source; the
 * `home level NN` typeIds are sequential by construction.
 *
 * Cross-system: the ConstructionSystem uses it as the home level-up trigger (next tier's materials
 * present → upgrade), and {@link stockCapacity} uses it so a still-upgradable home advertises the next
 * tier's cost as carrier-delivery demand.
 */
export function homeNextTier(type: BuildingType, ctx: SystemContext): BuildingType | undefined {
  if (type.kind !== 'home') return undefined;
  const next = ctx.content.buildings.find((t) => t.typeId === type.typeId + 1);
  return next?.kind === 'home' ? next : undefined;
}

/**
 * The current **population** of a `tribe`: the number of its living {@link Settler}s. The other half
 * of the housing read model ({@link housingCapacity} is the ceiling): the ReproductionSystem gates a
 * birth on `population < housingCapacity`, and a future "population vs housing capacity" invariant
 * compares the two. Counts every settler regardless of job (idle settlers are still mouths to house).
 *
 * Determinism: a pure count over `query(Settler)` (addition commutes — a count is order-independent,
 * so the store-order traversal is fine, like {@link workerPresentAt}'s any-match); no RNG/wall-clock.
 */
export function tribePopulation(world: World, tribe: number): number {
  let count = 0;
  for (const e of world.query(Settler)) {
    if (world.get(e, Settler).tribe === tribe) count++;
  }
  return count;
}

/**
 * Whether a building is a **temple** — the satisfier site for the piety need (where a settler runs
 * the `pray` atomic). The original's "work temple" (`logichousetype` `logictype 37`, the
 * `HOUSE_TYPE_WORK_TEMPLE` constant) is a `logicmaintype 3` workplace that, unlike a real production
 * workplace, declares **no `logicworker`, no `logicstock`, no `logicproduction`** — so it surfaces in
 * the IR as `kind === 'workplace'` with an empty `workers`, empty `stock`, and **no `recipe`**. That
 * "workplace with nothing to make and no one to staff it" shape is how a temple is told apart from a
 * sawmill/mill (which always carry a recipe + workers).
 *
 * FIDELITY (approximated — see docs/FIDELITY.md): the temple→pray need→satisfier link lives below the
 * readable rule files (the original binds the religious building to the pray slot at the engine level,
 * not in `houses.ini`), so the satisfier is *inferred* from this structural signature — exactly like
 * the food→eat-slot binding ({@link isFood}) is inferred from the `food_` id prefix. Refine to a
 * content flag if the building→need binding is later decoded. Cross-system: the AI pray-drive planner
 * uses it to find the nearest temple to walk to.
 */
export function isTemple(world: World, ctx: SystemContext, building: Entity): boolean {
  const b = world.tryGet(building, Building);
  if (b === undefined) return false;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  if (type === undefined) return false;
  return type.kind === 'workplace' && type.recipe === undefined && type.workers.length === 0;
}

/**
 * Whether a raw cell id is a valid index into the terrain graph (`0..cellCount-1`, integer). A
 * request/goal id outside the grid is boundary input — callers treat it as "no route" rather than
 * letting it throw inside the search.
 *
 * Cross-system: used by the AI navigation planner (drop an off-map goal) and the pathfinding system
 * (guard the A* endpoints).
 */
export function inRange(terrain: TerrainGraph, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < terrain.cellCount;
}

/**
 * The cell an entity occupies — its {@link Position} snapped to the terrain grid. The plain positional
 * resolver for units/creatures/fixtures (a settler, a herd animal, a resource node), where the entity's
 * own tile IS the cell to measure from. Building targets a settler must reach *through a door* use the
 * AI planner's interaction-aware resolver instead (walls are walk-blocked); this is the common case,
 * shared by combat targeting and the herding follow-drive.
 */
export function entityCell(world: World, terrain: TerrainGraph, e: Entity): CellId {
  const p = world.get(e, Position);
  return terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
}

/** Integer Manhattan distance between two cells — the cheap reach/nearness heuristic the AI planner,
 *  combat range check, and herding leader-distance measure with (A* computes the real path cost). */
export function manhattan(terrain: TerrainGraph, a: CellId, b: CellId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

/** Duration (ticks) used when an atomic's animation-length chain doesn't resolve — a non-zero default
 *  so an unresolved atomic still takes visible time rather than completing instantly. */
const DEFAULT_ATOMIC_DURATION = 4;

/**
 * Resolve an atomic's duration (animation length in ticks) through the data: the settler's tribe binds
 * `(jobType, atomicId)` to an animation name (`setatomic`, last-wins) and `atomicAnimations` gives that
 * name's `length`. Falls back to {@link DEFAULT_ATOMIC_DURATION} when the chain doesn't resolve (the
 * readable mod set is a subset of the base animations, and test fixtures may bind neither) — a missing
 * timing must not hang or zero-out the atomic. Shared by the AI planner (harvest/eat/sleep/pray/haul)
 * and combat (the attack swing); both resolve durations the identical way.
 */
export function atomicDuration(
  ctx: SystemContext,
  settler: { tribe: number; jobType: number | null },
  atomicId: number,
): number {
  return atomicDurationForName(ctx, atomicAnimationName(ctx, settler, atomicId));
}

/**
 * The duration (ticks) of a named animation — its `atomicanimations.ini` `length`, or
 * {@link DEFAULT_ATOMIC_DURATION} when the name is undefined / unresolved / zero-length. The
 * name-keyed half of {@link atomicDuration}, split out so a caller that has already resolved the
 * animation NAME (e.g. the combat swing-start, which reads the same animation's hit-frame too) can get
 * the duration WITHOUT re-walking the tribe's `setatomic` bindings a second time.
 */
export function atomicDurationForName(ctx: SystemContext, animation: string | undefined): number {
  if (animation === undefined) return DEFAULT_ATOMIC_DURATION;
  const anim = ctx.content.atomicAnimations.find((a) => a.name === animation);
  const length = anim?.length ?? 0;
  return length > 0 ? length : DEFAULT_ATOMIC_DURATION;
}

/**
 * Resolve the **animation name** a settler's tribe binds `(jobType, atomicId)` to — the `setatomic`
 * join key, last-wins over the file-order bindings (matching the original's config-override
 * semantics). Returns `undefined` when the settler has no job, its tribe isn't in content, or no
 * binding matches (the readable mod set is a subset of the base animations). The shared name lookup
 * behind {@link atomicDuration} (the animation's `length`) and the combat swing's hit-frame / need-drain
 * reads (its `events`), so all three resolve the animation the identical way.
 */
export function atomicAnimationName(
  ctx: SystemContext,
  settler: { tribe: number; jobType: number | null },
  atomicId: number,
): string | undefined {
  if (settler.jobType === null) return undefined;
  const tribe = ctx.content.tribes.find((t) => t.typeId === settler.tribe);
  if (tribe === undefined) return undefined;
  let animation: string | undefined;
  for (const b of tribe.atomicBindings) {
    if (b.jobType === settler.jobType && b.atomicId === atomicId) animation = b.animation;
  }
  return animation;
}
