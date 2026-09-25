import { CurrentAtomic } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { liveWorkFlag } from '../../../economy/work-flag.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../cadence.js';
import {
  type GathererReach,
  gathererReach,
  nearestLiveResource,
  type WorkableTest,
} from '../../live-resources.js';
import { anchorNodeOf } from '../../node-geometry.js';
import {
  claimFlagNode,
  FLAG_MAX_DISTANCE_NODES,
  nodeDistance,
  replantSpot,
  type TakenFlagNodes,
} from '../flag-spots.js';
import type { WantedGood } from './wanted-goods.js';

/** Every how many of a seat's decisions the collector flags are re-aimed at the nearest live resource
 *  (authored). 30 decisions is about 60 s at the base clock. */
export const FLAG_RELOCATE_EVERY_DECISIONS = 30;

export function flagRelocateDue(ctx: SystemContext): boolean {
  return Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS) % FLAG_RELOCATE_EVERY_DECISIONS === 0;
}

/**
 * The upkeep over one good's current holders, each serving its anchor in `anchors`, index for index. A
 * flag whose holder would find nothing of the good to harvest from it ({@link patchWorked}) is re-planted
 * beside the workable resource nearest its anchor, one standing past the band from that resource is moved
 * after it when `relocateDue` and a nearer spot exists, and a holder whose good has left the map rejoins
 * the builder pool. Every re-plant claims its node, since holders of one good resolve the same nearest
 * resource and would otherwise share a tile.
 */
export function upkeepHolders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  w: WantedGood,
  holders: readonly Entity[],
  anchors: readonly HalfCellNode[],
  workable: WorkableTest,
  taken: TakenFlagNodes,
  relocateDue: boolean,
  builderJob: number | null,
  commands: PlayerCommand[],
): void {
  const reach = gathererReach(world, ctx, terrain);
  const ofGood = (goodType: number): boolean => goodType === w.good.typeId;
  for (const [rank, holder] of holders.entries()) {
    const flag = liveWorkFlag(world, holder);
    const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (flag === undefined || flagNode === null) continue; // vanished mid-decision - next pass rehires
    const alive = patchWorked(world, reach, holder, flagNode, flag.radius, ofGood);
    if (alive && !relocateDue) continue;
    const anchor = anchors[rank];
    if (anchor === undefined) continue;
    const nearest = (open: WorkableTest): Entity | null =>
      nearestLiveResource(world, w.good.typeId, anchor, (e) => workable(e) && open(e));
    if (alive) {
      // Cheap drift check first: a flag still in its nearest resource's band pays no spot search.
      const current = nearest(everyResource);
      const currentNode = current === null ? null : anchorNodeOf(world, current);
      if (currentNode === null || nodeDistance(flagNode, currentNode) <= FLAG_MAX_DISTANCE_NODES) continue;
    }
    const replant = replantSpot(world, ctx, terrain, holder, flag.radius, nearest, reach, taken);
    if (replant === 'dry') {
      // The map ran out of this good - the collector rejoins the builder pool.
      if (!alive && builderJob !== null)
        commands.push({ kind: 'setJob', entity: holder, jobType: builderJob });
      continue;
    }
    if (replant === null) continue; // nothing this holder could work from a free spot - try next decision
    const { target, spot } = replant;
    if (spot.hx === flagNode.hx && spot.hy === flagNode.hy) continue;
    if (alive && nodeDistance(spot, target) >= nodeDistance(flagNode, target)) continue; // no nearer spot
    commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
    claimFlagNode(taken, spot);
  }
}

/** The {@link WorkableTest} that drops nothing, for a search that has tried no resource yet. */
export const everyResource: WorkableTest = () => true;

/**
 * Whether a holder's patch still feeds him: he is mid-action, or his own harvest search from the flag
 * would take a resource `wanted` accepts. Only an idle holder pays for the search, so the per-decision
 * cost follows the idle holders rather than every flag.
 */
export function patchWorked(
  world: World,
  reach: GathererReach,
  holder: Entity,
  flagNode: HalfCellNode,
  radius: number,
  wanted: (goodType: number) => boolean,
): boolean {
  return world.has(holder, CurrentAtomic) || reach.patchHarvestable(holder, flagNode, radius, wanted);
}
