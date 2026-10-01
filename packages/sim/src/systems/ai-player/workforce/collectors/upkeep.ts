import { CurrentAtomic } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import { FOLLOW_FLAG_BAND, forgetReplantMisses, replantMissesAt } from '../../../assistant/flag-follow.js';
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
import { claimFlagNode, nodeDistance, replantSpot, type TakenFlagNodes } from '../flag-spots.js';
import type { CollectorGround } from './allocate.js';
import type { WantedGood } from './wanted-goods.js';

/** Every how many of a seat's decisions a collector flag is re-aimed at the nearest live resource
 *  (authored). 30 decisions is about two minutes at the base clock. */
export const FLAG_RELOCATE_EVERY_DECISIONS = 30;

/** Whether this tick's decision re-aims `holder`'s flag. Each holder's round is offset by his id, so a
 *  seat's holders pay the re-aim over the whole round instead of all on one decision. */
export function flagRelocateDue(ctx: SystemContext, holder: Entity): boolean {
  const decision = Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS);
  return (decision + holder) % FLAG_RELOCATE_EVERY_DECISIONS === 0;
}

/** How many re-plant searches in a row may find nothing before a holder whose patch is worked out
 *  rejoins the builder pool, as one whose good has left the map does (authored). */
export const REPLANT_MISSES_BEFORE_RETIRE = 3;

/**
 * The upkeep over one good's current holders, each serving its anchor in `anchors`, index for index. A
 * holder whose patch is worked out ({@link patchWorked}) waits for the assistant's flag follow, which the
 * seat keeps on, to move his flag, and rejoins the builder pool once the good has left the map or the
 * follow's re-plants keep finding nothing ({@link hopelessPost}). A working holder standing past the band
 * from the resource nearest his anchor is moved after it on his {@link flagRelocateDue} decision when a
 * nearer spot exists. Every re-plant claims its node, since holders of one good resolve the same nearest
 * resource and would otherwise share a tile.
 */
export function upkeepHolders(
  world: World,
  ctx: SystemContext,
  ground: CollectorGround,
  w: WantedGood,
  holders: readonly Entity[],
  anchors: readonly HalfCellNode[],
  taken: TakenFlagNodes,
  builderJob: number | null,
  commands: PlayerCommand[],
): void {
  const { workable } = ground;
  const reach = gathererReach(world, ctx, ground.flags.terrain);
  const ofGood = (goodType: number): boolean => goodType === w.good.typeId;
  // Holders sharing an anchor share its drift target: nothing this pass does moves a resource.
  const driftTargets = new Map<string, HalfCellNode | null>();
  for (const [rank, holder] of holders.entries()) {
    const flag = liveWorkFlag(world, holder);
    const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (flag === undefined || flagNode === null) continue; // vanished mid-decision - next pass rehires
    const anchor = anchors[rank];
    if (anchor === undefined) continue;
    const nearest = (open: WorkableTest): Entity | null =>
      nearestLiveResource(world, w.good.typeId, anchor, (e) => workable(e) && open(e));
    if (!patchWorked(world, reach, holder, flagNode, flag.radius, ofGood)) {
      if (builderJob !== null && hopelessPost(world, holder, flagNode, nearest))
        retireToBuilder(world, holder, builderJob, commands);
      continue;
    }
    if (!flagRelocateDue(ctx, holder)) continue;
    // Cheap drift check first: a flag still in its nearest resource's band pays no spot search.
    const key = `${anchor.hx},${anchor.hy}`;
    let currentNode = driftTargets.get(key);
    if (currentNode === undefined) {
      const current = nearest(everyResource);
      currentNode = current === null ? null : anchorNodeOf(world, current);
      driftTargets.set(key, currentNode);
    }
    // Within the band the flag follow keeps, the flag already serves: re-aiming it would only move it twice.
    if (currentNode === null || nodeDistance(flagNode, currentNode) <= FOLLOW_FLAG_BAND.max) continue;
    const replant = replantSpot(world, ground.flags, holder, flag.radius, nearest, anchor, reach, taken);
    if (replant === 'dry' || replant === null) continue;
    const { target, spot } = replant;
    if (spot.hx === flagNode.hx && spot.hy === flagNode.hy) continue;
    if (nodeDistance(spot, target) >= nodeDistance(flagNode, target)) continue; // no nearer spot
    commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
    claimFlagNode(taken, spot);
  }
}

/** Whether a worked-out holder's post is hopeless: the flag follow's re-plants from his flag have missed
 *  {@link REPLANT_MISSES_BEFORE_RETIRE} times in a row, or missed once and nothing `nearest` accepts
 *  stands on the map. The dry search waits for a miss, so a holder the follow is about to move pays none. */
export function hopelessPost(
  world: World,
  holder: Entity,
  flagNode: HalfCellNode,
  nearest: (open: WorkableTest) => Entity | null,
): boolean {
  const misses = replantMissesAt(world, holder, flagNode);
  return misses >= REPLANT_MISSES_BEFORE_RETIRE || (misses > 0 && nearest(everyResource) === null);
}

/** `holder` rejoins the builder pool, and his re-plant record goes with his post. */
export function retireToBuilder(
  world: World,
  holder: Entity,
  builderJob: number,
  commands: PlayerCommand[],
): void {
  commands.push({ kind: 'setJob', entity: holder, jobType: builderJob });
  forgetReplantMisses(world, holder);
}

/** The {@link WorkableTest} that drops nothing, for a search that has tried no resource yet. */
export const everyResource: WorkableTest = () => true;

/**
 * Whether a holder's patch still feeds him: he is mid-action, or his own harvest search from the flag
 * would take a resource `wanted` accepts. Only a holder not mid-action (walking included, since a walk
 * carries no CurrentAtomic) pays for the search.
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
