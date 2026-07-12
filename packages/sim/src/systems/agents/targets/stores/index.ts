import {
  Building,
  GroundDrop,
  Position,
  Stockpile,
  stockpileEntries,
  UnderConstruction,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain.js';
import type { SystemContext } from '../../../context.js';
import { manhattan } from '../../../spatial.js';
import {
  buildingProduces,
  isTemple,
  isYardHeap,
  lowestStockedGood,
  MAX_GROUND_STACK,
  recipeOf,
  stockCapacity,
} from '../../../stores.js';

import { closer } from '../nearest.js';

// The AI planner's TARGET-SCAN layer: build the per-tick candidate lists and answer every "nearest X"
// / "may this settler staff that workplace" query the atomic planner asks. Split out of ai.ts (which
// keeps the planner state-machine + drives + navigation) so each file is one job. Determinism: every
// scan walks the candidate lists in canonical (ascending entity-id) order with a Manhattan-distance +
// ascending-cell-id tie-break, so the winner never depends on store insertion history (goldens hold).

import type { TargetCandidates } from '../candidates.js';

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
  /** Skip EVERY store whose building type PRODUCES `goodType` — the haul-OUT mode. A carrier
   *  clearing a producer's output must deliver to STORAGE, never to another producer of the same
   *  good: with two farms and no nearer warehouse, per-entity exclusion of only the carrier's own
   *  farm made the sibling farm the "nearest store" and the wheat ping-ponged farm↔farm forever.
   *  Omit (false) for the ordinary "nearest capable store" pick — the farmer's reap gate counts its
   *  own farm's slot as a sink, and generic hauls may still top up a producer that CONSUMES the good. */
  excludeProducers = false,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (excludeProducers && buildingProduces(world, ctx, e).includes(goodType)) continue;
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
 * docs/tickets/sim/economy-ring-index.md).
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
import { interactionCell } from '../workplaces.js';
