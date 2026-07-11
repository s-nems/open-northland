import { MoveGoal, Owner } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import type { NodeBuckets } from '../spatial.js';

// The SPACING drives — the two consumers of the planner-tick occupancy state:
//  - idle spacing ({@link deStackIdle}): the last resort for a unit with nothing to do — step off a
//    tile shared with another resting unit so an idle crowd spreads out instead of stacking;
//  - work slots ({@link claimWorkCell}): a worker whose drive converges many units on ONE anchor
//    cell (builders hammering a construction site) claims a distinct stand cell in the anchor's
//    yard instead, so parallel workers spread out. Body collision can never do this: civilians are
//    deliberate pass-through (see movement/collision/bodies.ts), and the SeparationSystem displaces
//    only WALKING movers — two units STANDING on one node would never be pushed apart.

/**
 * The planner-tick SPACING state, built once per tick from the tick-start positions (stable across
 * the planner loop's own mutations — deliberately NOT updated as units are re-tasked): `occupancy`
 * buckets the owned resting units by tile, `claimed` stops two spacing consumers choosing the same
 * free cell, `blockedCells` lazily memoises the building walk-block overlay, and `yards` memoises
 * each work anchor's yard region ({@link claimWorkCell}) so one site's crew shares one derivation.
 * A tick with no crowded idle unit and no slot-claiming worker builds none of the lazy state.
 */
export interface SpacingState {
  readonly occupancy: NodeBuckets;
  readonly claimed: Set<NodeId>;
  blockedCells?: ReadonlySet<NodeId>;
  yards?: Map<NodeId, ReadonlySet<NodeId>>;
}

/** Max nodes a de-stack ring search visits before giving up — a boxed-in unit simply stays put.
 *  Quadrupled with the half-cell migration: nodes are 4× denser per world area, so this cap covers
 *  the same on-screen search radius the old 48-cell cap did. */
const SPACING_SEARCH_CAP = 192;

/**
 * The idle-spacing drive: if `e` — a resting, owned, otherwise-idle settler on half-cell node
 * (tileX,tileY) — shares that node with a LOWER-id resting owned settler, send it (a
 * {@link MoveGoal}) to the nearest free node so the two don't stand stacked. The lowest-id occupant
 * on the node is the keeper (it stays); every other occupant steps aside. A unit boxed in (no free
 * node within the search cap) just stays.
 *
 * This is the sim half of the "no hard collision, but units won't come to rest on an occupied node"
 * behaviour: transit is never blocked (a walker passes through freely), only a unit that has ARRIVED
 * with nothing to do relocates off a shared node. Determinism: the keeper test is a canonical id
 * compare; the target is a canonical breadth-first search; `claimed` keeps two de-stackers off the
 * same new node.
 */
export function deStackIdle(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  tileX: number,
  tileY: number,
  spacing: SpacingState,
): void {
  // Only PLAYER-owned units space out. An unowned settler is NOT in the owned-only `occupancy`, so the
  // keeper test below (`bucket[0] === e`) could never recognise it as the keeper — without this guard an
  // unowned unit sharing a tile with ≥2 owned resting units would wrongly de-stack. Gating here keeps the
  // unowned golden/economy fixtures byte-identical (the stated invariant) and neutrals put in real play.
  if (!world.has(e, Owner)) return;
  const bucket = spacing.occupancy.at(tileX, tileY);
  if (bucket.length < 2 || bucket[0] === e) return; // alone on the tile, or the keeper — hold ground
  // Build the building walk-block overlay once, only when a real de-stack is attempted (so a tick with no
  // crowded idle unit pays nothing). Excludes a target under a standing building: routing A* would refuse
  // a blocked goal, and a MoveGoal whose route can't resolve would freeze the unit (nothing clears a
  // failed non-player request), so we never aim at one.
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  const from = terrain.nodeAtClamped(tileX, tileY);
  const free = nearestFreeCell(terrain, from, spacing.occupancy, spacing.claimed, spacing.blockedCells);
  if (free === null) return; // boxed in — nothing better than staying
  spacing.claimed.add(free);
  world.add(e, MoveGoal, { cell: free });
}

/**
 * The 4-connected step radius of a work anchor's YARD — how far from a construction site's
 * interaction cell a builder may stand and still be working the site (4 half-cell steps ≈ two
 * visual tiles; the realistic handful of parallel builders each finds a free cell). A PLACEHOLDER
 * approximation: the original's readable mod data pins per-building stand cells —
 * `[GfxHouse] LogicConstructionWorkArea <sizeIdx> <dx> <dy> <run>` rows in `houses.ini`, the
 * building analog of the landscape work areas the sim already consumes — but the pipeline does not
 * extract that key yet, so the yard is a uniform door-anchored region until it does (tracked in
 * docs/plans/gathering-economy.md).
 */
export const WORK_YARD_RADIUS_NODES = 4;

/**
 * Claim a distinct STAND cell for a worker whose drive targets the shared `anchor` cell (a
 * construction site's interaction cell): the anchor itself when free, else the nearest free yard
 * cell — so parallel workers spread over the yard instead of stacking pixel-perfectly on one node.
 * The YARD is the connected region of walkable, unblocked nodes within
 * {@link WORK_YARD_RADIUS_NODES} 4-connected steps of the anchor — REACHABILITY, not raw distance,
 * so a cell across a stream or inside a footprint is never a work slot (a builder may not hammer
 * from terrain the site can't be worked from). Rules, in order:
 *
 *  - **Unowned settlers keep the exact-anchor behavior** (the same Owner gate as {@link deStackIdle}
 *    — the unowned golden/economy fixtures stay byte-identical).
 *  - **A worker already standing ALONE on a yard cell stays put**, so a hammering builder never hops
 *    cells between swings: any claimed cell is a yard cell, so the choice is stable across re-plans
 *    by construction. Alone — not the {@link deStackIdle} keeper rule — because a worker mid-swing
 *    does not re-plan: a keeper arriving on a node where a fellow already swings would start a
 *    SECOND swing on top of it and stack for a whole swing's length, while stepping aside costs the
 *    arriver a few walk ticks.
 *  - Otherwise the nearest free yard cell is claimed (the yard set iterates in ring order). A full
 *    (or empty) yard falls back to the anchor — the pre-slot stacking, never a refusal to work.
 *
 * Determinism: a canonical ring-ordered region plus an occupancy count, claims in planner order;
 * the yard is derived per (anchor, planner tick) — memoized on {@link SpacingState}, never hashed.
 */
export function claimWorkCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  anchor: NodeId,
  spacing: SpacingState,
): NodeId {
  if (!world.has(e, Owner)) return anchor; // unowned fixtures keep the shared-anchor behavior
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  spacing.yards ??= new Map();
  let yard = spacing.yards.get(anchor);
  if (yard === undefined) {
    yard = yardCells(terrain, anchor, spacing.blockedCells);
    spacing.yards.set(anchor, yard);
  }
  if (yard.has(here)) {
    const hereXY = terrain.coordsOf(here);
    const bucket = spacing.occupancy.at(hereXY.x, hereXY.y);
    // A planned owned settler is always in its own node's bucket (it is resting by the planner's
    // gates), so `claimed` needs no entry: the occupancy already keeps others off this cell.
    if (bucket.length === 0 || (bucket.length === 1 && bucket[0] === e)) return here;
  }
  for (const cell of yard) {
    if (spacing.claimed.has(cell)) continue;
    const { x, y } = terrain.coordsOf(cell);
    if (spacing.occupancy.at(x, y).length > 0) continue;
    spacing.claimed.add(cell);
    return cell;
  }
  return anchor; // yard full (or none walkable) — fall back to the shared anchor
}

/**
 * A work anchor's yard: every walkable, unblocked node reachable from `anchor` within
 * {@link WORK_YARD_RADIUS_NODES} 4-connected steps, in canonical ring order (anchor first when it
 * qualifies — Set insertion order is the claim priority). Blocked cells are neither entered nor
 * traversed, mirroring the pathfinder, so the yard never spans a wall or a stream the walk
 * couldn't cross. Bounded: ≤ ~2·R² nodes visited.
 */
function yardCells(terrain: TerrainGraph, anchor: NodeId, blocked: ReadonlySet<NodeId>): ReadonlySet<NodeId> {
  const yard = new Set<NodeId>();
  if (terrain.isWalkable(anchor) && !blocked.has(anchor)) yard.add(anchor);
  const seen = new Set<NodeId>([anchor]);
  let frontier: NodeId[] = [anchor];
  for (let depth = 0; depth < WORK_YARD_RADIUS_NODES; depth++) {
    const next: NodeId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n) || blocked.has(n)) continue;
        seen.add(n);
        yard.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return yard;
}

/**
 * The nearest cell to `from` that is walkable, unblocked by a building, holds no resting occupant, and
 * hasn't been claimed by another spacing consumer this tick — a breadth-first ring search over the
 * graph's canonical N,E,S,W neighbours (so the first hit at the minimum distance is
 * history-independent), bounded by {@link SPACING_SEARCH_CAP}. Returns null when nothing free is
 * reachable within the cap. Blocked cells are neither entered nor traversed, mirroring the pathfinder
 * that will carry the move out.
 */
function nearestFreeCell(
  terrain: TerrainGraph,
  from: NodeId,
  occupancy: NodeBuckets,
  claimed: ReadonlySet<NodeId>,
  blocked: ReadonlySet<NodeId>,
): NodeId | null {
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  let visited = 0;
  while (frontier.length > 0 && visited < SPACING_SEARCH_CAP) {
    const next: NodeId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n) || blocked.has(n)) continue;
        seen.add(n);
        visited++;
        const { x, y } = terrain.coordsOf(n);
        if (!claimed.has(n) && occupancy.at(x, y).length === 0) return n;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
