import { type Fixed, fx } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { HALF_COLUMN } from '../../../nav/world-metric.js';
import type { SystemContext } from '../../context.js';
import { dynamicBlockOverlay, resourceStanceCells, workFlagPlacementTest } from '../../footprint/index.js';
import { type NavigationLimit, networkLimitAt } from '../../signposts/index.js';
import { type GathererReach, nearestLiveResource, type WorkableTest } from '../live-resources.js';
import { anchorNodeOf } from '../node-geometry.js';
import { type WalkDistances, walkDistancesFrom, walkSeedNear } from '../walk-distance.js';

/** A collector's flag stands 2-3 tiles from its resource (authored) - 4..6 half-cell nodes. */
export const FLAG_MIN_DISTANCE_NODES = 4;
export const FLAG_MAX_DISTANCE_NODES = 6;
/** When the whole 2-3-tile band is blocked, any legal node this close still serves. */
const FLAG_FALLBACK_MAX_DISTANCE_NODES = 12;
/** How many nearest resources one re-plant tries (authored): a resource whose best flag spot is taken or
 *  from which the holder could not work it gives way to the next nearest. */
const REPLANT_ATTEMPTS = 3;

/** The nodes a flood from the gatherer's origin settles before it gives up (authored): about the disc a
 *  deposit ninety nodes out lies in, so a trip that long is still measured on foot. */
const ORIGIN_FLOOD_BUDGET_NODES = 16384;
/** The nodes the flood from a resource's work cells settles (authored): a disc some thirty nodes wide,
 *  enough to walk round a ridge or a grove to the band on its far side. */
const RESOURCE_FLOOD_BUDGET_NODES = 2048;
/** How far from an origin inside a building's body the flood seed may lie, in Manhattan nodes. */
const ORIGIN_SEED_RADIUS_NODES = 8;
/** What a candidate no flood reached costs on top of its straight-line distance, in tiles (authored):
 *  past every reached one, and among the unreached the nearest as the crow flies first. */
const UNREACHED_WALK_PENALTY_TILES = 4096;
/** How many times the gatherer's own leg, flag to work cell, weighs against the carriers' leg, origin to
 *  flag (authored): he walks his for every unit he digs, while the carriers spread theirs. */
const GATHERER_LEG_WEIGHT = 2;

/** The spots a decision has already handed out, which its later posts must keep off: two flags on one
 *  node would share a single delivery yard and its per-tile pile cap. A flag that already stands is in
 *  the placement blocker set, but one whose `setWorkFlag` is still in flight is invisible to it. */
export type TakenFlagNodes = Set<string>;

function flagNodeKey(hx: number, hy: number): string {
  return `${hx},${hy}`;
}

/** Manhattan distance between two half-cell nodes, the metric of the flag band. */
export function nodeDistance(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

export function claimFlagNode(taken: TakenFlagNodes, spot: HalfCellNode): void {
  taken.add(flagNodeKey(spot.hx, spot.hy));
}

/**
 * One decision's ground for the seat's flags: the terrain, the live walk-block overlay the floods walk
 * round, the placement test, and the seat's signpost confinement from `baseNode`, which every flag must
 * lie inside, since the engine snaps a `setWorkFlag` only within that reach and drops one aimed past it
 * (`orders/work/selection.ts`). Null while navigation is unconfined.
 */
export interface FlagGround {
  readonly terrain: TerrainGraph;
  readonly blocked: BlockOverlay;
  readonly limit: NavigationLimit | null;
  readonly placeable: (node: NodeId) => boolean;
}

export function flagGround(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  baseNode: HalfCellNode,
): FlagGround {
  return {
    terrain,
    blocked: dynamicBlockOverlay(world, ctx, terrain),
    limit: networkLimitAt(world, terrain, player, baseNode.hx, baseNode.hy),
    placeable: workFlagPlacementTest(world, ctx.content, terrain),
  };
}

/** The decision's legal work-flag test over `taken`: in bounds, placeable, inside the seat's confinement
 *  and not handed out yet. */
export function legalFlagNodeTest(
  ground: FlagGround,
  taken: TakenFlagNodes,
): (x: number, y: number) => boolean {
  const { terrain, limit, placeable } = ground;
  return (x, y) => {
    if (!terrain.inBounds(x, y) || taken.has(flagNodeKey(x, y))) return false;
    const node = terrain.nodeAt(x, y);
    return placeable(node) && (limit === null || limit.allowsNode(node));
  };
}

/**
 * The legal work-flag node in the 2-3-tile band around `resource` the shortest walk away: the gatherer's
 * leg from the spot to the resource's work cells, weighed {@link GATHERER_LEG_WEIGHT}, plus the carriers'
 * leg from `origin`, the base or workshop they walk out from, both floods over the live walk-block
 * overlay, so a spot behind a ridge or on the far side of the deposit loses to one the men reach straight.
 * A candidate a flood never reached ranks after every reached one by straight-line distance. Ties go to
 * the innermost ring, then the walk order. Any nearby legal node when the band is fully blocked; null when
 * none.
 */
export function flagSpotNear(
  world: World,
  ground: FlagGround,
  resource: Entity,
  origin: HalfCellNode,
  taken: TakenFlagNodes,
): HalfCellNode | null {
  const centre = anchorNodeOf(world, resource);
  if (centre === null) return null;
  const { terrain, blocked } = ground;
  const legal = legalFlagNodeTest(ground, taken);
  const originSeed = walkSeedNear(terrain, blocked, origin, ORIGIN_SEED_RADIUS_NODES);
  const fromOrigin = walkDistancesFrom(
    terrain,
    blocked,
    originSeed === null ? [] : [originSeed],
    ORIGIN_FLOOD_BUDGET_NODES,
  );
  const fromResource = walkDistancesFrom(
    terrain,
    blocked,
    resourceStanceCells(world, terrain, resource),
    RESOURCE_FLOOD_BUDGET_NODES,
  );
  const unreached = fx.fromInt(UNREACHED_WALK_PENALTY_TILES);
  const cost = (x: number, y: number): Fixed => {
    const node = terrain.nodeAt(x, y);
    const at = { hx: x, hy: y };
    // A straight-line leg is measured in half columns, the lattice's own E/W step.
    const legOf = (flood: WalkDistances, from: HalfCellNode): Fixed =>
      flood.costTo(node) ?? fx.add(unreached, fx.mul(fx.fromInt(nodeDistance(at, from)), HALF_COLUMN));
    return fx.add(
      fx.mul(fx.fromInt(GATHERER_LEG_WEIGHT), legOf(fromResource, centre)),
      legOf(fromOrigin, origin),
    );
  };
  return (
    cheapestRingNode(centre, FLAG_MIN_DISTANCE_NODES, FLAG_MAX_DISTANCE_NODES, legal, cost) ??
    cheapestRingNode(centre, 0, FLAG_FALLBACK_MAX_DISTANCE_NODES, legal, cost)
  );
}

/** The accepted node of least `cost` over the Manhattan rings `minRadius..maxRadius` around `centre`,
 *  the first walked on ties (innermost ring first, then the ring walk). */
function cheapestRingNode(
  centre: HalfCellNode,
  minRadius: number,
  maxRadius: number,
  accept: (x: number, y: number) => boolean,
  cost: (x: number, y: number) => Fixed,
): HalfCellNode | null {
  let best: HalfCellNode | null = null;
  let bestCost: Fixed | null = null;
  for (let r = minRadius; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const dy = r - Math.abs(dx);
      for (let side = dy === 0 ? 1 : 0; side < 2; side++) {
        const x = centre.hx + dx;
        const y = side === 0 ? centre.hy - dy : centre.hy + dy;
        if (!accept(x, y)) continue;
        const c = cost(x, y);
        if (bestCost !== null && c >= bestCost) continue;
        best = { hx: x, hy: y };
        bestCost = c;
      }
    }
  }
  return best;
}

/** The flag spot beside the good's workable live resource nearest `anchor`, or null when the map holds
 *  none (or no legal flag node stands near it). */
export function collectorSpot(
  world: World,
  ground: FlagGround,
  anchor: HalfCellNode,
  goodType: number,
  taken: TakenFlagNodes,
  workable: WorkableTest,
): HalfCellNode | null {
  const resource: Entity | null = nearestLiveResource(world, goodType, anchor, workable);
  return resource === null ? null : flagSpotNear(world, ground, resource, anchor, taken);
}

/** A re-plant: the resource the flag moves after and the spot beside it, `dry` when the map holds no
 *  candidate at all, or null when none of the nearest {@link REPLANT_ATTEMPTS} was one the holder could
 *  work. On null the holder keeps his post and the next decision retries: re-hiring him at the anchor spot
 *  would only churn (hire, dead patch, retire, hire). */
export type Replant = { readonly target: HalfCellNode; readonly spot: HalfCellNode } | 'dry' | null;

/**
 * Where `holder` re-plants a flag of `radius`: beside the resource `nearest` picks, the shortest walk from
 * `origin` (the anchor the search runs from) and to the resource, checked with the gatherer's own filters
 * from the new spot, trying the next nearest after a miss. `nearest` must honour the `open` test it is
 * given, which drops the resources already tried. Up to {@link REPLANT_ATTEMPTS} spot searches per call;
 * the callers pay them only for a holder not mid-action or on the periodic upkeep.
 */
export function replantSpot(
  world: World,
  ground: FlagGround,
  holder: Entity,
  radius: number,
  nearest: (open: WorkableTest) => Entity | null,
  origin: HalfCellNode,
  reach: GathererReach,
  taken: TakenFlagNodes,
): Replant {
  const tried = new Set<Entity>();
  const open = (e: Entity): boolean => !tried.has(e);
  for (let attempt = 0; attempt < REPLANT_ATTEMPTS; attempt++) {
    const resource = nearest(open);
    if (resource === null) return attempt === 0 ? 'dry' : null;
    const target = anchorNodeOf(world, resource);
    const spot = target === null ? null : flagSpotNear(world, ground, resource, origin, taken);
    if (target !== null && spot !== null && reach.canWork(holder, spot, radius, resource)) {
      return { target, spot };
    }
    tried.add(resource);
  }
  return null;
}
