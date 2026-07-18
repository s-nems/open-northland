import type { ContentSet } from '@open-northland/data';
import { DeliveryFlag } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { forEachRingOffset, sameCells } from '../geometry.js';
import { EXCLUSION, eachBlockerCell, placementBlockerVersion } from './blockers.js';

// WORK-FLAG PLACEMENT — where a work flag (and, through canPlaceWorkFlag, a signpost) may stand: the same
// ./blockers.ts scan the building rule reads, minus the EXCLUSION channel and plus the markers.

/** Per-world memo of the no-`ignoreFlag` blocked set, keyed on {@link workFlagBlockerVersion} (plus
 *  content/terrain identity, like the signpost probe's memo). The memo feeds command gates and sim
 *  decisions — `canPlaceWorkFlag`, the auto-flag plant — so the version being complete is load-bearing:
 *  every store the scan reads bumps it, including the flag-MOVE counter. Rebuild-on-bump, so it cannot
 *  drift by a missed patch; the residual risk is the KEY missing an input (the class the move counter
 *  plugs), which is what the registered `verifyCaches` verifier trips on. */
interface BlocksMemo {
  readonly version: string;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly blocked: ReadonlySet<NodeId>;
}
const blocksMemo = new WeakMap<World, BlocksMemo>();

/** The nodes a work flag may NOT occupy: every standing resource/building body cell plus the other
 *  markers' cells — every {@link eachBlockerCell} channel except {@link EXCLUSION}, since a
 *  resource/building margin zone remains valid open ground for a flag. The common no-`ignoreFlag` set
 *  is memoized per {@link workFlagBlockerVersion} (see {@link blocksMemo}), so reads between two
 *  blocker changes share one store walk. (A burst that itself PLANTS flags still rebuilds per plant —
 *  each add must invalidate the memo so the next pick sees the flag just planted.) The `ignoreFlag`
 *  variant (a flag re-placed over its own cell) would need its own key, so that rare one-shot path
 *  builds fresh. */
export function workFlagPlacementBlocks(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  ignoreFlag?: Entity,
): ReadonlySet<NodeId> {
  if (ignoreFlag !== undefined) return buildBlocks(world, content, terrain, ignoreFlag);
  const version = workFlagBlockerVersion(world);
  const hit = blocksMemo.get(world);
  if (hit !== undefined && hit.version === version && hit.content === content && hit.terrain === terrain) {
    return hit.blocked;
  }
  const blocked = buildBlocks(world, content, terrain, undefined);
  blocksMemo.set(world, { version, content, terrain, blocked });
  world.registerCacheVerifier('workFlagPlacementBlocks', () => verifyBlocksMemo(world, content, terrain));
  return blocked;
}

/** The {@link blocksMemo} coherence verifier: while the key claims freshness, a re-derive must agree —
 *  the tripwire for a blocker input {@link workFlagBlockerVersion} fails to see (`verifyCaches`). */
function verifyBlocksMemo(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const hit = blocksMemo.get(world);
  if (hit === undefined || hit.content !== content || hit.terrain !== terrain) return [];
  if (hit.version !== workFlagBlockerVersion(world)) return []; // stale key — the next read rebuilds
  const fresh = buildBlocks(world, content, terrain, undefined);
  if (sameCells(hit.blocked, fresh)) return [];
  return [
    `workFlagPlacementBlocks memo holds ${hit.blocked.size} nodes but re-derived ${fresh.size} — a blocker changed without a workFlagBlockerVersion bump`,
  ];
}

function buildBlocks(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  ignoreFlag: Entity | undefined,
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
