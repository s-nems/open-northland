import type { Command } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { liveWorkFlag } from '../../../economy/work-flag.js';
import { AI_DECISION_INTERVAL_TICKS, anchorNodeOf, nearestLiveResource } from '../../shared.js';
import {
  claimFlagNode,
  FLAG_MAX_DISTANCE_NODES,
  flagSpotNear,
  patchAlive,
  type TakenFlagNodes,
} from '../flag-spots.js';
import type { WantedGood } from './wanted-goods.js';

/** Every how many of a seat's decisions the collector flags are re-aimed at the nearest live
 *  resource - the infrequent "nudge the flags after the patch drifted" upkeep (user rule
 *  2026-07-18). 30 decisions ≈ 60 s at the base clock. */
export const FLAG_RELOCATE_EVERY_DECISIONS = 30;

export function flagRelocateDue(ctx: SystemContext): boolean {
  return Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS) % FLAG_RELOCATE_EVERY_DECISIONS === 0;
}

/**
 * The upkeep over one good's current holders: a flag whose patch ran dry is re-planted beside the
 * nearest live resource, one whose patch is alive but has receded past the band is nudged after it
 * when `relocateDue`, and a holder whose good has left the map entirely rejoins the builder pool.
 * Every re-plant claims its node like a fresh post: two holders of the same good resolve the same
 * nearest resource, so without that they would be sent to one tile.
 */
export function upkeepHolders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  w: WantedGood,
  holders: readonly Entity[],
  taken: TakenFlagNodes,
  relocateDue: boolean,
  builderJob: number | null,
  commands: Command[],
): void {
  for (const holder of holders) {
    const flag = liveWorkFlag(world, holder);
    const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (flag === undefined || flagNode === null) continue; // vanished mid-decision - next pass rehires
    if (patchAlive(world, flagNode, flag.radius, (r) => r.goodType === w.good.typeId)) {
      if (!relocateDue) continue;
      const near = nearestLiveResource(world, w.good.typeId, flagNode);
      const nearNode = near === null ? null : anchorNodeOf(world, near);
      if (nearNode === null) continue;
      const drift = Math.abs(nearNode.hx - flagNode.hx) + Math.abs(nearNode.hy - flagNode.hy);
      if (drift <= FLAG_MAX_DISTANCE_NODES) continue; // still in the band - leave the flag be
      const spot = flagSpotNear(world, ctx, terrain, nearNode, taken);
      if (spot !== null && (spot.hx !== flagNode.hx || spot.hy !== flagNode.hy)) {
        commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
        claimFlagNode(taken, spot);
      }
      continue;
    }
    const next = nearestLiveResource(world, w.good.typeId, flagNode);
    if (next === null) {
      // The map ran out of this good - the collector rejoins the builder pool.
      if (builderJob !== null) commands.push({ kind: 'setJob', entity: holder, jobType: builderJob });
      continue;
    }
    const node = anchorNodeOf(world, next);
    const spot = node === null ? null : flagSpotNear(world, ctx, terrain, node, taken);
    if (spot !== null) {
      commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
      claimFlagNode(taken, spot);
    }
  }
}
