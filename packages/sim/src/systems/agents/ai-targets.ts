import {
  BerryBush,
  Building,
  Crop,
  GroundDrop,
  HarvestedBy,
  JobAssignment,
  Position,
  Resource,
  Stockpile,
  stockpileEntries,
  UnderConstruction,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import { bushesNearNode } from '../berry-index.js';
import type { SystemContext } from '../context.js';
import { BERRY_FORAGE_RADIUS } from '../economy/berries.js';
import { interactionNode, positionedInteractionCell, resourceWorkCell } from '../footprint/index.js';
import { buildingEnabled, settlerMeetsNeed } from '../progression.js';
import { canonicalResources, resourceHarvestAtomics, resourcesNearNode } from '../resource-index.js';
import { canonicalById, manhattan } from '../spatial.js';
import {
  buildingWorkerJobs,
  isFood,
  isTemple,
  isYardHeap,
  lowestStockedGood,
  recipeOf,
  stockCapacity,
} from '../stores.js';
import { MAX_GROUND_STACK } from './effects-goods.js';

/**
 * The shared nearest-pick tie-break: is a candidate at `(dist, cell)` strictly better than the
 * running best? Minimum Manhattan distance first, then the lower interaction-CELL id — the one
 * canonical (seeker-independent) comparison every nearest-X scan in this file applies, so the six
 * scans can never drift apart. A pure boolean over four ints — it cannot change any winner.
 */
function closer(dist: number, cell: number, bestDist: number, bestCell: number): boolean {
  return dist < bestDist || (dist === bestDist && cell < bestCell);
}

// The AI planner's TARGET-SCAN layer: build the per-tick candidate lists and answer every "nearest X"
// / "may this settler staff that workplace" query the atomic planner asks. Split out of ai.ts (which
// keeps the planner state-machine + drives + navigation) so each file is one job. Determinism: every
// scan walks the candidate lists in canonical (ascending entity-id) order with a Manhattan-distance +
// ascending-cell-id tie-break, so the winner never depends on store insertion history (goldens hold).

/**
 * The atomic planner's target candidates for one tick, each an **ascending-entity-id** list — the same
 * order `world.canonicalEntities()` scanned, so the distance + id tie-break in every `nearest*` helper
 * still picks the identical winner (goldens stay byte-identical). Built once per tick by {@link
 * collectTargets} and shared across all settlers instead of each re-scanning + re-sorting the whole world.
 */
export interface TargetCandidates {
  /** Harvest targets: entities with {@link Resource} + {@link Position}. */
  readonly resources: readonly Entity[];
  /** Stores / food stores / workplace outputs: entities with {@link Stockpile} + {@link Position}. */
  readonly stockpiles: readonly Entity[];
  /** Building-keyed targets (temples): entities with {@link Building} + {@link Position}. */
  readonly buildings: readonly Entity[];
  /**
   * Construction sites — entities with {@link UnderConstruction} + {@link Building} + {@link Position}, the
   * **tiny subset** the builder drive (hammer / self-supply) and the delivery router scan, so they never
   * walk the whole {@link buildings} / {@link stockpiles} lists to find the rare foundation: with nothing
   * under construction the scan is O(0), the dormancy a big idle building count needs to stay cheap.
   */
  readonly constructionSites: readonly Entity[];
  /**
   * Felled trunks / dropped-good piles — entities with {@link GroundDrop} + {@link Stockpile} +
   * {@link Position}. The **tiny subset** a collector's own-trunk drive scans, so it never walks the
   * whole {@link stockpiles} list (which includes every building store + delivery flag): with no drops
   * on the map the collect scan is O(0), the dormancy the drive needs to stay cheap for a big idle crowd.
   */
  readonly groundDrops: readonly Entity[];
  /**
   * Sown fields — entities with {@link Crop} + {@link Position} (each also carries a {@link Resource}).
   * The **tiny subset** the farmer drive scans for its reap/water picks and per-farm field count, so a
   * world with no farms costs O(0) — the same dormancy shape as {@link groundDrops}.
   */
  readonly crops: readonly Entity[];
  /**
   * `goodType → its harvest atomic id` (the good's `atomicForHarvesting`), built once per tick from
   * content — a lookup index so the collect scan resolves a dropped good's harvest atomic without a
   * `content.goods.find` per pile per settler (the content-index anti-pattern, packages/sim/AGENTS.md).
   */
  readonly harvestAtomicByGood: ReadonlyMap<number, number>;
}

/**
 * Snapshot the planner's target categories once for the tick. Each `query` is one pass over the matching
 * entities; {@link canonicalById} makes the scan order canonical (ascending id), matching the old
 * full-world scan so the winner — and therefore every golden — is unchanged. This is what turns the
 * planner from `O(settlers · entities · log n)` (per-settler re-scan + re-sort of the world) into
 * `O(entities + settlers · candidates)`, the fix for the big-crowd stall (see {@link atomicPlanner}).
 */
export function collectTargets(world: World, ctx: SystemContext): TargetCandidates {
  // A content-load-static good→harvestAtomic index (rebuilt per tick — cheap, O(goods)), so the collect
  // scan resolves a dropped good's harvest atomic by lookup, not a `content.goods.find` per pile.
  const harvestAtomicByGood = new Map<number, number>();
  for (const g of ctx.content.goods) {
    if (g.atomics.harvest !== undefined) harvestAtomicByGood.set(g.typeId, g.atomics.harvest);
  }
  return {
    // Memoized against the Resource store generation (spatial.ts): a decoded map holds ~17k standing
    // nodes, and re-sorting them here EVERY tick was a milliseconds-scale cost on its own.
    resources: canonicalResources(world),
    stockpiles: canonicalById(world.query(Stockpile, Position)),
    buildings: canonicalById(world.query(Building, Position)),
    constructionSites: canonicalById(world.query(UnderConstruction, Building, Position)),
    groundDrops: canonicalById(world.query(GroundDrop, Stockpile, Position)),
    crops: canonicalById(world.query(Crop, Position)),
    harvestAtomicByGood,
  };
}

/**
 * The nearest harvestable {@link Resource} the given settler is allowed to harvest, by fixed-point
 * Manhattan distance from `here`, with ascending-cell-id as the deterministic tie-break. A resource
 * is eligible only if it has units remaining, is REACHABLE (same static component as the settler —
 * see the `componentOf` gate below), AND its harvest passes **both** data-driven gates:
 *
 *  - the job's `allowedAtomics` permits the resource good's harvest atomic (a woodcutter harvests
 *    trees, not ore — {@link jobAtomics});
 *  - the settler's accrued XP clears the harvested good's `needforgood` thresholds for its tribe
 *    ({@link settlerMeetsNeed}) — the *who-may-do-it* progression gate, the per-settler sibling of the
 *    production-side tribe-presence `jobEnablesGood` gate. A settler trains a good's track by
 *    harvesting it (`grantWorkExperience`), so a low-XP settler is held out of the goods whose
 *    threshold it hasn't yet reached; an unthresholded good (no `needforgood`) is harvestable by any
 *    settler, so this gate is inert where no requirement exists.
 *
 * Returns the resource entity, or null if none qualifies. Scanned in canonical entity-id order so the
 * result never depends on store insertion history. Determinism: both gates are pure reads over content
 * + the settler's components (no RNG/wall-clock).
 *
 * `area` bounds the scan to a **gatherer's flag work-area** ({@link WorkFlag}): only nodes whose work cell
 * is within `radius` (integer node-distance) of `center` qualify, and the winner is the one NEAREST THE
 * FLAG (so a bound gatherer works outward from its flag, not wherever it happens to stand). Omitted — the
 * default for an unbound roaming collector — measures from `here` with no radius, the prior behaviour
 * byte-for-byte (so the golden slice is untouched). **With `area` set, `candidates` is superseded** by
 * the resource region index (`resourcesNearNode` — a provable superset of the in-radius nodes); pass the
 * full canonical resource list, never a pre-filtered one, or the two paths disagree on the winner.
 *
 * Known limitation (like the bridge case): the reachability gate below reads STATIC components only. A
 * same-component node whose anchor and every work cell are enclosed by DYNAMIC resource footprints (a
 * sealed pocket deep in a dense forest) can still win the pick and then fail its path. Route-level
 * dynamic reachability is a separate follow-up (see `docs/plans/gathering-economy.md`).
 */
export function nearestHarvestableFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  settler: { jobType: number; tribe: number; experience: ReadonlyMap<number, number> },
  area?: { center: NodeId; radius: number },
): Entity | null {
  const allowed = jobAtomics(ctx, settler.jobType);
  // Dormancy gate: if the job's allowed atomics intersect NO harvest atomic present on any standing
  // resource, every candidate fails the `allowed.has` check below — the whole scan is provably null.
  // Skip it in O(distinct present atomics ≈ goods) instead of walking the entire resource list per such
  // settler per tick (with thousands of map-spawned nodes that per-settler full scan is the dominant sim
  // cost). This covers not just atomic-less jobs but every NON-HARVEST trade that still carries atomics —
  // an idle builder (build atomic only) used to fall through planBuilder into this scan every tick. The
  // probe set is derived from the ACTUAL resources (the region index), so a fixture node carrying an
  // out-of-content atomic still gates exactly. Same result — a non-harvester still gets null — so the
  // golden slice is byte-identical; only the wasted iteration is elided.
  const present = resourceHarvestAtomics(world);
  let anyHarvestable = false;
  for (const atomic of present) {
    if (allowed.has(atomic)) {
      anyHarvestable = true;
      break;
    }
  }
  if (!anyHarvestable) return null;
  // Rank + range from the flag when bound; from the settler when roaming (the unbound default is identical
  // to the prior nearest-to-`here` scan — same origin, no radius filter).
  const origin = area?.center ?? here;
  const radius = area?.radius ?? Number.POSITIVE_INFINITY;
  // A radius-bounded (flag) scan reads only the resources whose ANCHOR lies within the radius box —
  // widened by the content's max work-cell offset, so every node whose WORK cell could pass the radius
  // test below is provably included (`resourcesNearNode`). Same filter/rank loop over an ascending-id
  // superset ⇒ the identical winner as the full scan, at O(nearby) instead of O(all resources) per
  // gatherer per tick (a decoded map holds ~17k standing nodes). A roaming (unbound) scan keeps the
  // full canonical list — the golden path, byte-for-byte.
  const scanned =
    area !== undefined
      ? resourcesNearNode(
          world,
          terrain.coordsOf(origin).x,
          terrain.coordsOf(origin).y,
          area.radius + contentIndex(ctx.content).maxResourceWorkOffset,
        )
      : candidates;
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of scanned) {
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) continue;
    if (!world.has(e, Position)) continue;
    if (!allowed.has(res.harvestAtomic)) continue; // data-driven gate: job must permit this atomic
    // XP gate: this settler must have cleared the harvested good's `needforgood` thresholds.
    if (!settlerMeetsNeed(ctx, settler.tribe, 'good', res.goodType, settler.experience)) continue;
    const cell = interactionCell(world, ctx, terrain, e, here); // work cell the settler walks to (from here)
    // Reachability gate: a resource walled off from the settler by static terrain — the far bank of a
    // river with no land crossing — sits in a DIFFERENT connected component, so `findPath` would reject
    // the route outright (nav/pathfinding.ts answers "no route" from the SAME `componentOf` verdict).
    // Without this, the nearest-by-Manhattan pick can latch onto such a tree and the flag-bound gatherer
    // stalls forever trying to path to it ("stoi bezczynnie obok flagi"), never falling through to a
    // reachable tree slightly farther. `componentOf` is an O(1) array read (a build-time flood-fill), and
    // a same-component candidate is unaffected — so a map with every tree reachable (the golden slice) is
    // byte-identical. Measured from `here`, the settler's actual route start (bridges are not yet walkable
    // in the collision join, so the two banks are genuinely separate components — a named limitation).
    if (terrain.componentOf(here) !== terrain.componentOf(cell)) continue;
    const dist = manhattan(terrain, origin, cell); // distance from the flag (bound) or the settler (roaming)
    if (dist > radius) continue; // outside the flag's work radius — a bound gatherer leaves it be
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest **collectable ground drop** a felling collector should carry off — a bare
 * {@link GroundDrop} trunk pile (a felled tree's dropped wood) whose good THIS settler's job may
 * harvest — with its Manhattan distance, or null if none is in reach. Scoped two ways so it stays the
 * collector's *own-trade* loop, not a general porter drive: (1) to `GroundDrop` piles only (a felled
 * trunk / dropped good), never a designated delivery flag or a boat hull — both equally-bare
 * `Stockpile`s; (2) to a good the settler harvests, via the SAME {@link jobAtomics} gate
 * {@link nearestHarvestableFor} uses (a woodcutter collects wood, not a stonecutter's dropped stone).
 *
 * Nearest by Manhattan + ascending-cell-id (canonical scan); the pile's good is its lowest-id stocked
 * good ({@link stockpileEntries}, never raw Map order). The planner weighs the returned `dist` against
 * {@link nearestHarvestableFor}'s node so, standing on its fresh trunk (distance 0), the collector
 * picks the wood up before wandering to the next tree — the original's fell-then-carry cadence.
 * Unlike harvesting, collecting an already-dropped good applies no `needforgood` XP gate (carrying a
 * trunk is hauling, not harvesting). Determinism: pure reads over content + components, no RNG.
 */
export function nearestCollectablePileFor(
  candidates: readonly Entity[],
  harvestAtomicByGood: ReadonlyMap<number, number>,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  jobType: number,
): { pile: Entity; goodType: number; dist: number } | null {
  const allowed = jobAtomics(ctx, jobType);
  let best: { pile: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  // `candidates` is the GroundDrop candidate list, so every entry already has GroundDrop+Stockpile+Position
  // (built by collectTargets) — no per-pile marker re-check, and the scan is O(drops), ~0 when none exist.
  for (const e of candidates) {
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) continue; // an emptied drop (about to be reaped) — nothing to collect
    const harvestAtomic = harvestAtomicByGood.get(good);
    if (harvestAtomic === undefined || !allowed.has(harvestAtomic)) continue; // not this job's trade
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = { pile: e, goodType: good };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best === null ? null : { ...best, dist: bestDist };
}

/**
 * The nearest ground drop THIS gatherer harvested into being — a {@link GroundDrop} whose {@link HarvestedBy}
 * owner is `owner` — with its Manhattan distance from `here`, or null if it holds none. This is the
 * flag-bound gatherer's collect drive: it reclaims the trunk/ore IT felled or mined and delivers it to its
 * flag, and — unlike {@link nearestCollectablePileFor}'s trade-wide scan — it ignores every pile it did not
 * make (another gatherer's trunk, a player-dropped heap), the "carry only what you dug" rule. Nearest by
 * Manhattan + ascending-cell-id (canonical scan); the pile's good is its lowest-id stocked good. A
 * fully-collected drop empties and is reaped, so it drops out of the scan naturally. Determinism: pure reads
 * over components, no RNG; a stored owner id is stable (entity ids are monotonic, never reused).
 */
export function nearestOwnDropFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  owner: Entity,
): { pile: Entity; goodType: number; dist: number } | null {
  let best: { pile: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    const mark = world.tryGet(e, HarvestedBy);
    if (mark === undefined || mark.by !== owner) continue; // not this gatherer's own drop — leave it be
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) continue; // an emptied drop (about to be reaped) — nothing to collect
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = { pile: e, goodType: good };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best === null ? null : { ...best, dist: bestDist };
}

/**
 * The nearest store (a {@link Building} with a {@link Stockpile}) that can stock `goodType` — i.e.
 * its building type declares a stock slot for that good and the slot is not already full — by
 * Manhattan distance from `here`, ascending-cell-id tie-break, scanned in canonical entity-id order.
 * Returns the store entity or null if none can take the good.
 *
 * A workplace that PRODUCES `goodType` (a recipe output) is never a delivery target for it — goods
 * are hauled *out* of a producer to a store, never back into it (otherwise a carrier would deposit
 * its load straight back where it picked it up and livelock). A workplace consuming the good as an
 * input, or a passive store, is a valid sink.
 */
export function nearestStoreFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  goodType: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    // A GroundDrop (a felled trunk / dropped good) is a SOURCE to collect, never a delivery SINK —
    // otherwise a collector would deposit the wood straight back into the trunk it just lifted from
    // (a livelock).
    if (world.has(e, GroundDrop)) continue;
    // A bare loose goods pile (a hand-dropped heap or a gatherer's yard heap) is likewise NEVER a sink.
    // It has no store TYPE, so {@link stockCapacity} treats it as uncapped: a carrier that can't reach a
    // real store (every warehouse full for the good) would "deliver" its load into the nearest loose pile,
    // which a porter immediately re-collects — the good shuttles pile→back→pile forever (the full-store
    // livelock). A real sink is a TYPED store: a Building (warehouse/HQ/workshop) or a Vehicle hull.
    if (isYardHeap(world, e)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe?.outputs.some((o) => o.goodType === goodType)) continue; // never deliver to its producer
    const stock = world.get(e, Stockpile);
    const have = stock.amounts.get(goodType) ?? 0;
    if (have >= stockCapacity(world, ctx, e, goodType)) continue; // full for this good — skip
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The greatest Manhattan ring radius (in half-cell NODES) {@link nearestFreeYardNode} searches out from a
 * flag before giving up. A ring at half-cell distance `r` holds O(r) nodes; radius 32 (~16 tiles across) is
 * far more room than any single gatherer's yard needs — the bound only stops a pathological unbounded
 * search. Named approximation (the original's goods-yard extent is not decoded).
 */
const GOODS_YARD_MAX_RADIUS = 32;

/**
 * The nearest HALF-CELL node around a gatherer's `flag` whose yard tile still has room for another unit of
 * `good` — the tile a flag-bound gatherer physically WALKS to and sets its load down on, so the goods land
 * where its feet are (never teleporting to a distant tile) and heaps pack TILE-TO-TILE on the half-cell
 * lattice. Spirals out from the flag's node in Manhattan rings; a tile has room when it holds no heap, or a
 * heap of `good` below {@link MAX_GROUND_STACK} (a tile holding a DIFFERENT good, or a full one, is skipped),
 * and it must be walkable (a gatherer can't stand where it can't walk). Within the nearest ring with any free
 * node it returns the canonical (lowest-id) one; falls back to the flag's own node when the yard is saturated
 * within the bound (the load then simply waits — better than teleporting).
 *
 * Determinism: `occupied` is BUILT from the canonical candidate list and only `.get`-queried (never iterated
 * for a decision), and the ring pick is canonical. `candidates` is the per-tick stockpile list. Cost is
 * O(candidates) to index + a BOUNDED ring walk (up to {@link GOODS_YARD_MAX_RADIUS}², a constant, returning
 * at the first ring with a free node) — the same O(carriers·stockpiles) economy nearest-X shape as the other
 * scans here (a `NodeBuckets` index that would make both terms local is the shared follow-up in
 * docs/plans/sim-perf.md).
 */
export function nearestFreeYardNode(
  candidates: readonly Entity[],
  world: World,
  terrain: TerrainGraph,
  flag: Entity,
  good: number,
): NodeId {
  const fp = world.get(flag, Position);
  const fn = nodeOfPosition(fp.x, fp.y);
  const flagNode = terrain.nodeAtClamped(fn.hx, fn.hy);
  // Index each YARD heap (bare Stockpile+Position — not a building store, felled trunk, or the flag) by its
  // node → the good it holds + how many. A tile is BLOCKED for `good` when it holds a different good or a
  // full stack of `good`; an empty/absent heap leaves it free.
  const occupied = new Map<NodeId, { good: number; fill: number }>();
  for (const e of candidates) {
    if (!isYardHeap(world, e)) continue;
    const stock = world.get(e, Stockpile);
    const pos = world.get(e, Position);
    const g = lowestStockedGood(stock);
    if (g === null) continue; // an empty heap leaves the tile free
    const n = nodeOfPosition(pos.x, pos.y);
    occupied.set(terrain.nodeAtClamped(n.hx, n.hy), { good: g, fill: stock.amounts.get(g) ?? 0 });
  }
  const hasRoom = (node: NodeId): boolean => {
    const o = occupied.get(node);
    return o === undefined || (o.good === good && o.fill < MAX_GROUND_STACK);
  };
  const { x: cx, y: cy } = terrain.coordsOf(flagNode);
  for (let r = 0; r <= GOODS_YARD_MAX_RADIUS; r++) {
    let best: NodeId | null = null;
    for (let dy = -r; dy <= r; dy++) {
      const dxMag = r - Math.abs(dy); // the Manhattan ring |dx| + |dy| = r
      for (const dx of dxMag === 0 ? [0] : [-dxMag, dxMag]) {
        const node = terrain.nodeAtClamped(cx + dx, cy + dy);
        if (terrain.isWalkable(node) && hasRoom(node) && (best === null || node < best)) best = node;
      }
    }
    if (best !== null) return best;
  }
  return flagNode; // yard saturated within the bound — wait on the flag tile rather than teleport
}

/**
 * The nearest store (a {@link Stockpile} on a positioned entity) that HOLDS at least one unit of
 * `goodType` — a SOURCE to fetch from, by Manhattan distance from `here`, ascending-cell-id tie-break,
 * scanned in canonical entity-id order. A construction site is **excluded** (it is a delivery sink, not a
 * source — a builder never strips the material it just delivered), but a warehouse or a loose ground pile
 * that holds the good is fair game. Returns the source store or null if none holds the good. The counter
 * to {@link nearestStoreFor} (which finds a store that can TAKE a good); the builder drive uses it to fetch
 * a construction material its site is short on.
 */
export function nearestStoreHolding(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  goodType: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    if (world.has(e, UnderConstruction)) continue; // a site is a sink, never a source to strip
    if ((world.get(e, Stockpile).amounts.get(goodType) ?? 0) <= 0) continue; // doesn't hold the good
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest store (a {@link Stockpile} on a positioned entity) that holds at least one unit of an
 * edible good ({@link isFood}), by Manhattan distance from `here`, ascending-cell-id tie-break,
 * scanned in canonical entity-id order. Returns the store and the specific food good to eat, or null
 * if no reachable store holds food. The good within a store is chosen in canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order — so the choice never
 * depends on store insertion history. A producing workplace counts too (a settler eats the food it
 * makes); the eater consumes one unit on the `eat` atomic's completion (AtomicSystem).
 */
export function nearestFoodStore(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): { store: Entity; goodType: number; dist: number; cell: NodeId } | null {
  let best: { store: Entity; goodType: number; dist: number; cell: NodeId } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const stock = world.get(e, Stockpile);
    // Find the store's candidate food FIRST (its lowest-goodType stocked edible); only a store that
    // holds food pays for the interaction-cell + distance work (pure elision — same winner).
    let food: number | null = null;
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0 || !isFood(ctx, goodType)) continue;
      food = goodType;
      break; // this store's lowest-id food good is its candidate
    }
    if (food === null) continue;
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = { store: e, goodType: food, dist, cell };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The extra reach (half-cell nodes) a {@link bushesNearNode} query adds over {@link BERRY_FORAGE_RADIUS}
 * so the region box is a provable SUPERSET of the true "interaction cell within radius" set. A bush is
 * non-blocking, so its interaction cell IS its anchor unless a resource footprint overlaps the tile, in
 * which case `positionedInteractionCell` picks an immediate walkable neighbour (≤2 nodes off) — this
 * covers that displacement, so the cellDist filter below still picks the same winner as a full scan.
 */
const BUSH_INTERACTION_SLACK_NODES = 2;

/**
 * The nearest RIPE {@link BerryBush} a hungry settler could forage, by Manhattan distance from `here`
 * with the shared ascending-cell-id tie-break — the eat drive's WILD-FOOD fallback ({@link nearestFood}).
 * Only a bush that currently holds fruit (`ripe`), lies within {@link BERRY_FORAGE_RADIUS} of the settler,
 * and is REACHABLE (same terrain component as `here`, the same gate {@link nearestHarvestableFor} applies
 * so a settler never latches onto a bush across an uncrossable river) qualifies. Returns the bush + its
 * distance/cell (so {@link nearestFood} can weigh it against a store), or null if none is in reach.
 *
 * Scans only the bushes NEAR the settler ({@link bushesNearNode}, the region index) rather than every bush
 * on the map — a decoded map spawns tens of thousands, and this runs per hungry settler, so a full scan is
 * the golden-rule-6 per-entity-loop trap. The region box (widened by {@link BUSH_INTERACTION_SLACK_NODES})
 * is a provable superset of the radius disc, and the filter/rank loop is unchanged, so the winner is
 * identical to a full scan. Determinism: the candidate list is ascending-id and the pick is canonical.
 */
export function nearestRipeBush(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): { bush: Entity; dist: number; cell: NodeId } | null {
  const { x: hx, y: hy } = terrain.coordsOf(here);
  const candidates = bushesNearNode(world, hx, hy, BERRY_FORAGE_RADIUS + BUSH_INTERACTION_SLACK_NODES);
  let best: { bush: Entity; dist: number; cell: NodeId } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    const bush = world.tryGet(e, BerryBush);
    if (bush === undefined || !bush.ripe) continue; // bare/regrowing — nothing to forage
    const cell = interactionCell(world, ctx, terrain, e, here);
    if (terrain.componentOf(here) !== terrain.componentOf(cell)) continue; // walled off — leave it be
    const dist = manhattan(terrain, here, cell);
    if (dist > BERRY_FORAGE_RADIUS) continue; // beyond the forage reach (interim, pre-signpost limit)
    if (closer(dist, cell, bestDist, bestCell)) {
      best = { bush: e, dist, cell };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/** A resolved food target for the eat drive: a store to eat a stocked/produced good FROM, or a wild
 *  {@link BerryBush} to forage. The union {@link nearestFood} returns so the drive dispatches the right
 *  atomic (`eat` vs `forage`). */
export type FoodTarget =
  | { readonly kind: 'store'; readonly store: Entity; readonly goodType: number }
  | { readonly kind: 'bush'; readonly bush: Entity };

/**
 * The nearest FOOD of any kind a hungry settler should head for — the eat drive's "find the nearest food"
 * primitive. It weighs the nearest food STORE ({@link nearestFoodStore}, sought UNBOUNDED — a settlement's
 * larder is always worth walking to) against the nearest ripe wild BUSH ({@link nearestRipeBush}, the
 * bounded {@link BERRY_FORAGE_RADIUS} fallback) with the ONE shared {@link closer} tie-break, so the winner
 * is whichever is genuinely nearer — an equal-distance tie is broken by the lower interaction-cell id (so a
 * bush CAN win a distance tie when its cell id is lower; the pick stays deterministic, cell ids being
 * position-derived). Returns null when neither is in reach.
 *
 * The wild bush is a FALLBACK in practice (a settled larder is usually the nearer food), but the choice is
 * pure nearest-food, not "bush only if no store" — a settler beside a berry patch eats the berries rather
 * than trek to a distant granary. With no bushes near the settler the bush scan is O(0) and the result is
 * exactly {@link nearestFoodStore}'s, so every existing eat golden holds.
 */
export function nearestFood(
  targets: TargetCandidates,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): FoodTarget | null {
  const store = nearestFoodStore(targets.stockpiles, world, ctx, terrain, here);
  const bush = nearestRipeBush(world, ctx, terrain, here);
  if (bush !== null && (store === null || closer(bush.dist, bush.cell, store.dist, store.cell))) {
    return { kind: 'bush', bush: bush.bush };
  }
  if (store !== null) return { kind: 'store', store: store.store, goodType: store.goodType };
  return null;
}

/**
 * The nearest {@link isTemple temple} a devout settler should walk to in order to pray, by Manhattan
 * distance from `here`, ascending-cell-id tie-break, scanned in canonical entity-id order. Returns the
 * temple entity or null if no temple exists. This is the piety need's satisfier→building-target lookup
 * — the genuinely-new piece a target-bound need introduces (eat resolves to a store, sleep to no site;
 * pray resolves to a specific building the settler must reach).
 */
export function nearestTemple(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Building) || !world.has(e, Position)) continue;
    if (!isTemple(world, ctx, e)) continue;
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest **construction site** a builder of `tribe` should raise — a {@link Building} still marked
 * {@link UnderConstruction} (a placed foundation being built up), by Manhattan distance from `here` with
 * an ascending-cell-id tie-break, scanned in canonical entity-id order (so the winner never depends on
 * store insertion history). Returns the site entity or null if the tribe has no site under construction.
 * The builder drive walks here to hammer it, or — when the site has no material left to install — fetches
 * a missing construction good for it. Scans the {@link TargetCandidates.constructionSites} list — only the
 * sites still under construction — so with no foundations in progress the scan is O(0) however many
 * finished buildings stand, and a builder cohort never walks the whole building list to find nothing.
 */
export function nearestConstructionSite(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  tribe: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  // `candidates` is the construction-site list (UnderConstruction + Building + Position guaranteed by
  // collectTargets), so only the tribe filter remains — no per-entity marker re-check.
  for (const e of candidates) {
    if (world.get(e, Building).tribe !== tribe) continue; // another tribe's site
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * Whether ANY workplace holds a haulable output this tick — a producing {@link Building} ({@link recipeOf}
 * defined) whose {@link Stockpile} holds ≥1 unit of one of its recipe outputs. The population-level gate
 * for {@link nearestWorkplaceOutput}: if this is false no carrier can haul, so idle settlers skip the
 * per-settler scan entirely (the same "holds an output" test the scan's inner loop applies, so a false
 * here means every scan would return null — identical behavior, done once instead of per settler). It is
 * deliberately WEAKER than the full scan (no "a store can take it" check): a true still runs the real
 * scan, which returns null if delivery is impossible — the gate only ever elides a provably-empty scan.
 */
export function hasHaulableOutput(world: World, ctx: SystemContext, stockpiles: readonly Entity[]): boolean {
  for (const e of stockpiles) {
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue;
    const stock = world.get(e, Stockpile);
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount > 0 && recipe.outputs.some((o) => o.goodType === goodType)) return true;
    }
  }
  return false;
}

/**
 * The nearest workplace with a finished output good a carrier should haul away to a store. A
 * candidate is a {@link Building} with a {@link Stockpile} whose building type carries a `recipe`
 * (it is a workplace, so a stocked good is finished output, not a passive store's reserve), holding
 * at least one unit of one of its recipe's output goods that a *different* store can stock. Returns
 * the workplace and the specific good to haul, or null if nothing needs hauling.
 *
 * Determinism: workplaces are scanned in canonical entity-id order with a Manhattan-distance +
 * ascending-cell-id tie-break; within a workplace the good is chosen by canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order. The "some other
 * store can take it" check ({@link nearestStoreFor}) keeps the carrier from picking up a good it
 * could never deliver (which would just shuttle it back and forth).
 */
export function nearestWorkplaceOutput(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): { workplace: Entity; goodType: number } | null {
  let best: { workplace: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue; // not a workplace — passive stores aren't hauled FROM
    const stock = world.get(e, Stockpile);
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    // Canonical (ascending goodType) so the chosen good never depends on Map insertion history.
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0) continue;
      if (!recipe.outputs.some((o) => o.goodType === goodType)) continue; // only haul outputs
      // Deliverability check reuses the SAME stockpile candidates (a store is a Stockpile+Position too).
      if (nearestStoreFor(candidates, world, ctx, terrain, cell, goodType) === null) continue;
      if (closer(dist, cell, bestDist, bestCell)) {
        best = { workplace: e, goodType };
        bestDist = dist;
        bestCell = cell;
      }
      break; // this workplace's lowest haulable goodType is its candidate; move to the next workplace
    }
  }
  return best;
}

/**
 * The set of atomic ids a job may run: its `allowedAtomics` ∪ `baseAtomics`, minus `forbiddenAtomics`
 * (an explicit denial overrides an allow). An unknown jobType yields an empty set (no permissions),
 * so a settler with a job absent from content harvests nothing rather than everything. This is the
 * data-driven permission gate from `jobtypes` — the planner picks atomics the job is allowed, never
 * a hardcoded per-job list.
 */
export function jobAtomics(ctx: SystemContext, jobType: number): ReadonlySet<number> {
  return contentIndex(ctx.content).atomicsByJob.get(jobType) ?? EMPTY_ATOMICS;
}

const EMPTY_ATOMICS: ReadonlySet<number> = new Set<number>();

/**
 * The building a bound `tribe` settler of `jobType` should WALK TO / hold at in order to staff it — its
 * {@link JobAssignment} workplace, the station the producer drive ({@link planProducer} in ai.ts) heads
 * for and pins on. The settler heads for *its own* mill, not the nearest unstaffed one, so it stays
 * latched across a brief step-off and two same-type workplaces staff independently. Returns the bound
 * building, or null when the settler isn't bound to a usable station (so it falls through to harvest/
 * haul / porter drives) — which holds when:
 *
 *  - it has no {@link JobAssignment} (an unassigned harvester — go harvest), OR
 *  - the bound building is gone / not a producing workplace it staffs / not tech-enabled / not the
 *    same tribe — a stale or unusable binding, treated as "no station" so the settler isn't stranded.
 *
 * Determinism: a single binding lookup + pure predicate checks, no chosen-entity ordering.
 */
export function boundWorkplaceTarget(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): Entity | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null; // unassigned: no station to walk to
  const b = binding.workplace;
  const building = world.tryGet(b, Building);
  if (building === undefined || building.tribe !== tribe) return null; // gone / wrong tribe
  if (recipeOf(world, ctx, b) === undefined) return null; // not a producing workplace
  if (!buildingWorkerJobs(world, ctx, b).has(jobType)) return null; // doesn't employ this job
  if (!buildingEnabled(world, ctx, tribe, building.buildingType)) return null; // not tech-enabled yet
  if (!world.has(b, Position)) return null; // a position-less workplace can't be walked to
  return b;
}

/**
 * The cell a walk-to / are-we-there target resolves to. For a {@link Building} this is its
 * **interaction tile** — the door cell when the type's footprint names one ({@link interactionNode}),
 * since the walls themselves are now walk-blocked and the original's settlers enter through the door.
 * A footprinted {@link Resource} resolves to its data-driven work cell, while an unfootprinted one
 * keeps the old anchor-tile fixture behavior. Everything else (a bare store fixture, a boat hull, a
 * loose ground drop) resolves to its {@link Position} tile unless that tile is under a resource walk
 * block, in which case the nearest free neighbour is used. Distances, walk goals, and the
 * `cell === here` arrival checks all resolve through here, so the goal a settler walks to and the
 * tile that counts as "at the target" can never disagree. Returns the interaction **node id** —
 * clamping the raw `{x,y}` that {@link interactionNode} resolves.
 */
export function interactionCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  from?: NodeId,
): NodeId {
  const at = interactionNode(world, ctx, e);
  if (at !== null) return terrain.nodeAtClamped(at.x, at.y);
  if (world.has(e, Resource)) return resourceWorkCell(world, terrain, e, from);
  return positionedInteractionCell(world, terrain, e, from);
}
