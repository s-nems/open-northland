import type { ContentSet } from '@open-northland/data';
import { DeliveryFlag, Position } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { LayeredBlocks } from '../../../nav/block-overlay.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { EXCLUSION, eachBlockerCell, placementBlockerVersion } from './blockers.js';

// WORK-FLAG PLACEMENT — where a work flag (and, through canPlaceWorkFlag, a signpost) may stand: the same
// ./blockers.ts scan the building rule reads, minus the EXCLUSION channel and plus the markers.

/** The per-world count of work-flag MOVES ({@link bumpWorkFlagMove}) — the one blocker channel that
 *  relocates in place, invisible to `componentGeneration`, so {@link workFlagBlockerVersion} folds it
 *  in. Cache metadata only: never hashed, and a rebuilt world restarting at 0 is fine — the version
 *  only needs to be distinct within one world's lifetime. */
const flagMoves = new WeakMap<World, number>();

/** Record a work-flag relocation — called by `relocateWorkFlag` (economy/flags.ts), the single
 *  relocate seam, so every mover invalidates the {@link workFlagBlockerVersion}-keyed memos (the
 *  signpost placement probe). */
export function bumpWorkFlagMove(world: World): void {
  flagMoves.set(world, (flagMoves.get(world) ?? 0) + 1);
}

/** The memoized STANDING layer below, valid while {@link placementBlockerVersion} (which sees every
 *  add/remove of a standing blocker) and the immutable inputs stand. */
const standingMemo = new WeakMap<
  World,
  { version: string; content: ContentSet; terrain: TerrainGraph; blocked: ReadonlySet<NodeId> }
>();

/** The standing (non-marker) flag blockers: every resource anchor+walk cell, building FAMILY body and
 *  signpost anchor — the {@link eachBlockerCell} channels minus {@link EXCLUSION} (a margin zone is open
 *  ground for a flag) and minus the markers. Memoized on {@link placementBlockerVersion}: none of these
 *  cells move (a home tier upgrade swaps `buildingType` in place, but the flag rule reads the
 *  tier-invariant family body), so only an add/remove — thousands of times rarer than the command
 *  bursts and AI decisions that ask — pays the full multi-thousand-resource rebuild. */
function standingFlagBlocks(world: World, content: ContentSet, terrain: TerrainGraph): ReadonlySet<NodeId> {
  const version = placementBlockerVersion(world);
  const cached = standingMemo.get(world);
  if (
    cached !== undefined &&
    cached.version === version &&
    cached.content === content &&
    cached.terrain === terrain
  ) {
    return cached.blocked;
  }
  const blocked = new Set<NodeId>();
  eachBlockerCell(world, content, (x, y, channel) => {
    if (channel === EXCLUSION) return;
    if (terrain.inBounds(x, y)) blocked.add(terrain.nodeAt(x, y));
  });
  standingMemo.set(world, { version, content, terrain, blocked });
  return blocked;
}

/** The nodes a work flag may NOT occupy — the memoized standing layer above plus the live marker
 *  cells (`DeliveryFlag` anchors, minus `ignoreFlag`), composed as a membership view. The marker set
 *  is rebuilt fresh per call — it is a handful of single cells, and rebuilding it is what lets a
 *  flag plant/move mid-tick be seen without invalidating the expensive standing layer. */
export function workFlagPlacementBlocks(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  ignoreFlag?: Entity,
): BlockOverlay {
  const markers = new Set<NodeId>();
  for (const e of world.query(DeliveryFlag, Position)) {
    if (e === ignoreFlag) continue;
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    if (terrain.inBounds(hx, hy)) markers.add(terrain.nodeAt(hx, hy));
  }
  return new LayeredBlocks([standingFlagBlocks(world, content, terrain), markers]);
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

/** The nearest legal work-flag node to `from`, by Manhattan distance then node id. Auto-created flags use
 * this when a gatherer spawns or changes trade, because its feet may currently be inside a resource or
 * building body. This is a one-shot command/spawn query, never per-tick planner work. */
export function nearestWorkFlagPlacement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
): NodeId | null {
  const origin = terrain.coordsOf(from);
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain);
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

/**
 * The version of the WORK-FLAG blocker inputs — {@link placementBlockerVersion} plus the `DeliveryFlag`
 * generation (add/remove) plus the flag-MOVE counter (a relocate mutates `Position` in place, which no
 * generation sees). The signpost placement overlay keys its memoized band probe on this.
 */
export function workFlagBlockerVersion(world: World): string {
  return `${placementBlockerVersion(world)}.${world.componentGeneration(DeliveryFlag)}.${flagMoves.get(world) ?? 0}`;
}
