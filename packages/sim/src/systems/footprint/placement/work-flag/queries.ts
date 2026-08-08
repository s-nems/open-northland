import { DeliveryFlag } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { closer, forEachRingOffset } from '../../geometry.js';
import { placementBlockerVersion } from '../blockers.js';
import { workFlagMoveCount } from './flag-moves.js';
import { workFlagPlacementBlocks } from './incremental-blocks.js';

// The work-flag placement queries - the command-gate and spawn-time picks over the incremental
// blocked set (./incremental-blocks.ts).

export function canPlaceWorkFlag(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  node: NodeId,
  ignoreFlag?: Entity,
): boolean {
  return (
    terrain.isWalkable(node) && !workFlagPlacementBlocks(world, ctx.content, terrain, ignoreFlag).has(node)
  );
}

/**
 * The greatest Manhattan ring radius {@link nearestWorkFlagPlacement} expands before falling back to the
 * whole-map reference scan. The cap only bounds the cost of a hopeless neighbourhood, since the fallback
 * reproduces the exact linear winner past it, so it is a performance knob rather than a decoded distance
 * (authored; the `RING_MAX_RADIUS` convention).
 */
const PLACEMENT_RING_MAX_RADIUS = 48;

/** The nearest legal work-flag node to `from`, by Manhattan distance then node id, with `from` itself as
 * the `r = 0` candidate. Auto-created flags use this when a gatherer spawns or changes trade, because its
 * feet may currently be inside a resource or building body, and the player's `setWorkFlag` uses it to snap
 * a click that landed on one. A one-shot command or spawn query, never per-tick planner work, but a
 * box-select `setJob` burst pays it per settler: expanding rings, never a whole-map scan, below the cap.
 *
 * `opts.ignoreFlag` excludes one flag's own spacing from the blocked set, so relocating a flag can land
 * back on ground its current marker reserves. `opts.accept` is an extra per-node gate the winner must also
 * pass (the player order's signpost confinement). `opts.withinRadius` makes the search BOUNDED: it stops at
 * that ring and returns null instead of falling back to the whole-map scan - what a player click wants
 * (snap off the body under the cursor, never teleport the flag across the map). */
export function nearestWorkFlagPlacement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  opts: {
    readonly ignoreFlag?: Entity | undefined;
    readonly accept?: ((node: NodeId) => boolean) | undefined;
    readonly withinRadius?: number | undefined;
  } = {},
): NodeId | null {
  const { accept, withinRadius } = opts;
  const origin = terrain.coordsOf(from);
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain, opts.ignoreFlag);
  const legal = (node: NodeId): boolean =>
    terrain.isWalkable(node) && !blocked.has(node) && (accept === undefined || accept(node));
  // The first ring holding a legal node ends the search; its lowest node id is the same
  // `(distance, node-id)` winner the reference scan below picks.
  for (let r = 0; r <= (withinRadius ?? PLACEMENT_RING_MAX_RADIUS); r++) {
    let ringBest: NodeId | null = null;
    forEachRingOffset(r, (dx, dy) => {
      const x = origin.x + dx;
      const y = origin.y + dy;
      if (!terrain.inBounds(x, y)) return;
      const node = terrain.nodeAt(x, y);
      if (!legal(node)) return;
      if (ringBest === null || node < ringBest) ringBest = node;
    });
    if (ringBest !== null) return ringBest;
  }
  if (withinRadius !== undefined) return null; // a bounded caller wants "nothing near", not a far spot
  // Nothing within the cap. The rings covered every node at distance ≤ cap, so only farther nodes can
  // match - the whole-map reference scan finds the same winner the uncapped search would.
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (let node = 0; node < terrain.nodeCount; node++) {
    const candidate = node as NodeId;
    if (!legal(candidate)) continue;
    const c = terrain.coordsOf(candidate);
    const distance = Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y);
    if (closer(distance, candidate, bestDistance, bestCell)) {
      best = candidate;
      bestDistance = distance;
      bestCell = candidate;
    }
  }
  return best;
}

/**
 * The version of the WORK-FLAG blocker inputs: {@link placementBlockerVersion}, the `DeliveryFlag`
 * generation, since this rule also consumes the marker channel the building rule ignores, and the
 * flag-MOVE count no generation sees. The signpost placement overlay keys its memoized band probe on this.
 */
export function workFlagBlockerVersion(world: World): string {
  return `${placementBlockerVersion(world)}.${world.componentGeneration(DeliveryFlag)}.${workFlagMoveCount(world)}`;
}
