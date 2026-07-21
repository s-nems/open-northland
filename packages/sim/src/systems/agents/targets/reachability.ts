import type { UnreachableGoal } from '../../../components/index.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { isUnreachableGoal } from '../unreachable-goals.js';

/** The three reachability layers {@link unreachableWorkCell} probes — bundled so its call sites name
 *  what they pass instead of ordering four lookalike positional arguments. */
export interface WorkCellGates {
  readonly terrain: TerrainGraph;
  readonly blocked: BlockOverlay;
  readonly memo: readonly UnreachableGoal[] | null;
}

/**
 * Whether walking to `cell` to work it is provably doomed: the goal is unwalkable, dynamically blocked
 * (`findPath` rejects a blocked GOAL — only the start is exempt), in another static component, or a goal
 * one of this settler's own routes just failed on. Targeting such a cell anyway strands the settler in a
 * park→re-pick→fail loop, so every target scan skips it until the ground opens up. Standing on the cell
 * already (`here`) needs no walk, so it is never doomed.
 *
 * Shared by the drives whose targets sit on open ground a building can later cover: a dug-out node's drop
 * under a neighbouring walk body (the gatherer's pile scans) and a sown field walled in by new
 * construction (the farmer's field and sheaf scans).
 */
export function unreachableWorkCell(gates: WorkCellGates, here: NodeId, cell: NodeId): boolean {
  if (cell === here) return false;
  const { terrain, blocked, memo } = gates;
  return (
    !terrain.isWalkable(cell) ||
    blocked.has(cell) ||
    isUnreachableGoal(memo, cell) ||
    terrain.componentOf(here) !== terrain.componentOf(cell)
  );
}
