import type { UnreachableGoal } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { constructionWorkCell } from '../../footprint/index.js';
import { isUnreachableGoal } from '../unreachable-goals.js';

/** The reachability layers {@link unreachableWorkCell} probes. */
export interface WorkCellGates {
  readonly terrain: TerrainGraph;
  readonly blocked: BlockOverlay;
  readonly memo: readonly UnreachableGoal[] | null;
}

/**
 * Whether walking to `cell` to work it is provably doomed: the goal is unwalkable, dynamically blocked
 * (`findPath` rejects a blocked goal, only the start is exempt), in another static component, or one
 * this settler's own routes just failed on. Targeting it anyway strands the settler in a re-pick loop.
 * Standing on the cell already needs no walk, so `here` is never doomed.
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

/**
 * The failed-goal veto for the construction-site picks, or undefined when the seeker remembers no
 * failures. A site is bucketed by its finished building's door, but every site route walks to a
 * perimeter work cell instead, so the cell-keyed `avoid` veto would never match; this probes the memo
 * at the stand the seeker would walk now. Approximation: crew spacing may claim a different perimeter
 * cell than this nearest stand, which is exact only for a crew-less site.
 */
export function unreachableSiteStand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  here: NodeId,
  avoid: ((cell: NodeId) => boolean) | undefined,
): ((site: Entity) => boolean) | undefined {
  if (avoid === undefined) return undefined;
  return (site) => {
    const stand = constructionWorkCell(world, ctx, terrain, site, blocked, here);
    return stand !== null && stand !== here && avoid(stand);
  };
}
