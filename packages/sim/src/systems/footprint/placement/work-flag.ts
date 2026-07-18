import type { ContentSet } from '@open-northland/data';
import { DeliveryFlag } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { forEachRingOffset } from '../geometry.js';
import { EXCLUSION, eachBlockerCell, placementBlockerVersion } from './blockers.js';

// WORK-FLAG PLACEMENT — where a work flag (and, through canPlaceWorkFlag, a signpost) may stand: the same
// ./blockers.ts scan the building rule reads, minus the EXCLUSION channel and plus the markers.

/** The nodes a work flag may NOT occupy: every standing resource/building body cell plus the other
 *  markers' cells — every {@link eachBlockerCell} channel except {@link EXCLUSION}, since a
 *  resource/building margin zone remains valid open ground for a flag. Built fresh per call — one-shot
 *  command checks call it through {@link canPlaceWorkFlag}; a per-node band probe (the signpost overlay)
 *  builds it once and reuses the set. */
export function workFlagPlacementBlocks(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  ignoreFlag?: Entity,
): ReadonlySet<NodeId> {
  const blocked = new Set<NodeId>();
  eachBlockerCell(
    world,
    content,
    (x, y, channel) => {
      if (channel === EXCLUSION) return; // a margin zone is open ground for a flag
      if (terrain.inBounds(x, y)) blocked.add(terrain.nodeAt(x, y));
    },
    { ignoreFlag },
  );
  return blocked;
}

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
 * The greatest Manhattan ring radius {@link nearestWorkFlagPlacement} expands before falling back to
 * the whole-map reference scan. The cap only bounds the cost of a hopeless neighbourhood — the
 * fallback reproduces the exact linear winner past it — so it is a pure performance knob, not a
 * decoded distance (named approximation; the `RING_MAX_RADIUS` convention).
 */
const PLACEMENT_RING_MAX_RADIUS = 48;

/** The nearest legal work-flag node to `from`, by Manhattan distance then node id. Auto-created flags use
 * this when a gatherer spawns or changes trade, because its feet may currently be inside a resource or
 * building body. This is a one-shot command/spawn query, never per-tick planner work — but it runs once
 * per employment command, so a box-select `setJob` burst pays it per settler: expanding rings, never a
 * whole-map scan, below the cap. */
export function nearestWorkFlagPlacement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
): NodeId | null {
  const origin = terrain.coordsOf(from);
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain);
  // The first ring holding a legal node ends the search; its lowest node id is the same
  // `(distance, node-id)` winner the reference scan below picks.
  for (let r = 0; r <= PLACEMENT_RING_MAX_RADIUS; r++) {
    let ringBest: NodeId | null = null;
    forEachRingOffset(r, (dx, dy) => {
      const x = origin.x + dx;
      const y = origin.y + dy;
      if (!terrain.inBounds(x, y)) return;
      const node = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(node) || blocked.has(node)) return;
      if (ringBest === null || node < ringBest) ringBest = node;
    });
    if (ringBest !== null) return ringBest;
  }
  // Nothing within the cap. The rings covered every node at distance ≤ cap, so only farther nodes can
  // match — the whole-map reference scan finds the same winner the uncapped search would.
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let node = 0; node < terrain.nodeCount; node++) {
    const candidate = node as NodeId;
    if (!terrain.isWalkable(candidate) || blocked.has(candidate)) continue;
    const c = terrain.coordsOf(candidate);
    const distance = Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y);
    if (distance < bestDistance || (distance === bestDistance && (best === null || candidate < best))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Per-world count of work-flag RELOCATIONS. `componentGeneration` sees only add/remove — a relocate
 *  mutates the flag's `Position` in place, and a flag is the one blocker that moves — so the version
 *  below counts moves explicitly. Bumped by the single relocate seam (`relocateWorkFlag`). */
const flagMoves = new WeakMap<World, number>();

/** Record one work-flag relocation, invalidating every {@link workFlagBlockerVersion}-keyed memo. */
export function noteWorkFlagMove(world: World): void {
  flagMoves.set(world, (flagMoves.get(world) ?? 0) + 1);
}

/**
 * The version of the WORK-FLAG blocker inputs — {@link placementBlockerVersion} plus the `DeliveryFlag`
 * generation, since this rule also consumes the marker channel the building rule ignores, plus the
 * flag-MOVE count the generation cannot see. The signpost placement overlay keys its memoized band
 * probe on this.
 */
export function workFlagBlockerVersion(world: World): string {
  return `${placementBlockerVersion(world)}.${world.componentGeneration(DeliveryFlag)}.${flagMoves.get(world) ?? 0}`;
}
