import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { liveWorkFlag } from '../../../economy/work-flag.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../cadence.js';
import { nearestLiveResource, type WorkableTest } from '../../live-resources.js';
import { anchorNodeOf } from '../../node-geometry.js';
import {
  claimFlagNode,
  FLAG_MAX_DISTANCE_NODES,
  flagSpotNear,
  patchAlive,
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
 * flag whose patch holds nothing workable is re-planted beside the workable resource nearest its anchor,
 * one standing past the band from that resource is moved after it when `relocateDue` and a nearer spot
 * exists, and a holder whose good has left the map rejoins the builder pool. Every re-plant claims its
 * node, since holders of one good resolve the same nearest resource and would otherwise share a tile.
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
  for (const [rank, holder] of holders.entries()) {
    const flag = liveWorkFlag(world, holder);
    const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (flag === undefined || flagNode === null) continue; // vanished mid-decision - next pass rehires
    const alive = patchAlive(world, flagNode, flag.radius, (r) => r.goodType === w.good.typeId, workable);
    if (alive && !relocateDue) continue;
    const anchor = anchors[rank];
    if (anchor === undefined) continue;
    const target = nearestLiveResource(world, w.good.typeId, anchor, workable);
    const targetNode = target === null ? null : anchorNodeOf(world, target);
    if (targetNode === null) {
      // The map ran out of this good - the collector rejoins the builder pool.
      if (!alive && builderJob !== null)
        commands.push({ kind: 'setJob', entity: holder, jobType: builderJob });
      continue;
    }
    const drift = nodeDistance(flagNode, targetNode);
    if (alive && drift <= FLAG_MAX_DISTANCE_NODES) continue; // still in the band - leave the flag be
    const spot = flagSpotNear(world, ctx, terrain, targetNode, taken);
    if (spot === null || (spot.hx === flagNode.hx && spot.hy === flagNode.hy)) continue;
    if (alive && nodeDistance(spot, targetNode) >= drift) continue; // no nearer spot to move to
    commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
    claimFlagNode(taken, spot);
  }
}

function nodeDistance(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}
