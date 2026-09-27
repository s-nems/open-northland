import { CurrentAtomic, ReplantMisses } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
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
import type { CollectorGround } from './allocate.js';
import type { WantedGood } from './wanted-goods.js';

/** Every how many of a seat's decisions the collector flags are re-aimed at the nearest live resource
 *  (authored). 30 decisions is about 60 s at the base clock. */
export const FLAG_RELOCATE_EVERY_DECISIONS = 30;

/** Whether `player`'s decision on this tick re-aims its collector flags. Each seat's round is offset by its
 *  number, so seats pay the re-aim on different decisions instead of all in one run of ticks. */
export function flagRelocateDue(ctx: SystemContext, player: number): boolean {
  const decision = Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS);
  return (decision + player) % FLAG_RELOCATE_EVERY_DECISIONS === 0;
}

/** Every how many of a seat's decisions a holder whose patch is worked out searches for a re-plant again
 *  after one found nothing (authored): the answer rarely changes between decisions, and each search
 *  floods for flag spots. 20 s at the base clock. */
export const REPLANT_RETRY_EVERY_DECISIONS = 10;

/** How many re-plant searches in a row may find nothing before a holder whose patch is worked out
 *  rejoins the builder pool, as one whose good has left the map does (authored). */
export const REPLANT_MISSES_BEFORE_RETIRE = 3;

/**
 * The upkeep over one good's current holders, each serving its anchor in `anchors`, index for index. A
 * flag whose holder would find nothing of the good to harvest from it ({@link patchWorked}) is re-planted
 * beside the workable resource nearest its anchor, one standing past the band from that resource is moved
 * after it when `relocateDue` and a nearer spot exists, and a holder whose good has left the map, or whose
 * re-plants keep finding nothing ({@link replantDue}), rejoins the builder pool. Every re-plant claims its
 * node, since holders of one good resolve the same nearest resource and would otherwise share a tile.
 */
export function upkeepHolders(
  world: World,
  ctx: SystemContext,
  ground: CollectorGround,
  w: WantedGood,
  holders: readonly Entity[],
  anchors: readonly HalfCellNode[],
  taken: TakenFlagNodes,
  relocateDue: boolean,
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
    const alive = patchWorked(world, reach, holder, flagNode, flag.radius, ofGood);
    if (alive) forgetReplantMissesWhileHarvesting(world, holder);
    if (alive ? !relocateDue : !replantDue(world, ctx, holder, flagNode)) continue;
    const anchor = anchors[rank];
    if (anchor === undefined) continue;
    const nearest = (open: WorkableTest): Entity | null =>
      nearestLiveResource(world, w.good.typeId, anchor, (e) => workable(e) && open(e));
    if (alive) {
      // Cheap drift check first: a flag still in its nearest resource's band pays no spot search.
      const key = `${anchor.hx},${anchor.hy}`;
      let currentNode = driftTargets.get(key);
      if (currentNode === undefined) {
        const current = nearest(everyResource);
        currentNode = current === null ? null : anchorNodeOf(world, current);
        driftTargets.set(key, currentNode);
      }
      if (currentNode === null || nodeDistance(flagNode, currentNode) <= FLAG_MAX_DISTANCE_NODES) continue;
    }
    const replant = replantSpot(world, ground.flags, holder, flag.radius, nearest, anchor, reach, taken);
    if (replant === 'dry' || replant === null) {
      // The map ran out of this good, or no spot has let him work it for his last misses - the collector
      // rejoins the builder pool. Otherwise he keeps his post, see Replant.
      if (!alive && (replant === 'dry' || replantMissed(world, holder, flagNode)) && builderJob !== null)
        retireToBuilder(world, holder, builderJob, commands);
      continue;
    }
    forgetReplantMisses(world, holder);
    const { target, spot } = replant;
    if (spot.hx === flagNode.hx && spot.hy === flagNode.hy) continue;
    if (alive && nodeDistance(spot, target) >= nodeDistance(flagNode, target)) continue; // no nearer spot
    commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
    claimFlagNode(taken, spot);
  }
}

/** Whether a holder whose patch is worked out searches for a re-plant on this decision: at once when no
 *  search from his flag has missed yet, then on his phase of every {@link REPLANT_RETRY_EVERY_DECISIONS},
 *  set by his id so a seat's stuck holders search on different decisions. */
export function replantDue(
  world: World,
  ctx: SystemContext,
  holder: Entity,
  flagNode: HalfCellNode,
): boolean {
  if (missesAt(world, holder, flagNode) === 0) return true;
  const decision = Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS);
  return (decision + holder) % REPLANT_RETRY_EVERY_DECISIONS === 0;
}

/** Records a re-plant search from `flagNode` that found nothing; true once the misses in a row reach
 *  {@link REPLANT_MISSES_BEFORE_RETIRE}. */
export function replantMissed(world: World, holder: Entity, flagNode: HalfCellNode): boolean {
  const misses = missesAt(world, holder, flagNode) + 1;
  if (world.has(holder, ReplantMisses)) {
    const live = world.mut(holder, ReplantMisses);
    live.hx = flagNode.hx;
    live.hy = flagNode.hy;
    live.misses = misses;
  } else {
    world.add(holder, ReplantMisses, { hx: flagNode.hx, hy: flagNode.hy, misses });
  }
  return misses >= REPLANT_MISSES_BEFORE_RETIRE;
}

export function forgetReplantMisses(world: World, holder: Entity): void {
  if (world.has(holder, ReplantMisses)) world.remove(holder, ReplantMisses);
}

/** Forgets the misses of a holder whose patch feeds him, unless he only reads as working because he is
 *  mid-action: a meal or a nap says nothing about his patch. */
export function forgetReplantMissesWhileHarvesting(world: World, holder: Entity): void {
  if (!world.has(holder, CurrentAtomic)) forgetReplantMisses(world, holder);
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

function missesAt(world: World, holder: Entity, flagNode: HalfCellNode): number {
  const record = world.tryGet(holder, ReplantMisses);
  return record !== undefined && record.hx === flagNode.hx && record.hy === flagNode.hy ? record.misses : 0;
}

/** The {@link WorkableTest} that drops nothing, for a search that has tried no resource yet. */
export const everyResource: WorkableTest = () => true;

/**
 * Whether a holder's patch still feeds him: he is mid-action, or his own harvest search from the flag
 * would take a resource `wanted` accepts. Only a holder not mid-action (walking included, since a walk
 * carries no CurrentAtomic) pays for the search, so the cost follows those holders rather than every flag.
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
