import {
  CurrentAtomic,
  ErectSignpostOrder,
  JobAssignment,
  PlayerOrder,
  UnderConstruction,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isMarried } from '../../family/eligibility.js';
import { scoutJobType } from '../../readviews/index.js';
import { seatBaseOf } from '../base.js';
import { type BuildOrderEntry, entryStatuses } from '../build-order/index.js';
import type { AiPlayerModule } from '../index.js';
import { nextLivestockCatch, nextSignpostTarget } from '../scout/index.js';
import { ownedBuildings, ownedSettlers } from '../shared.js';
import {
  allocateCollectors,
  allocateGenericCollectors,
  topUpCollectors,
  wantedCollectorGoods,
} from './collectors/index.js';
import { tuneCraftSelections } from './craft.js';
import type { TakenFlagNodes } from './flag-spots.js';
import { trainGarrison } from './garrison.js';
import { allocateOpeningHunter } from './hunter.js';
import { builderJobOf, classifyWorkforce, isAllocatableMan, SpareForce } from './pool.js';
import { reserveBuilders, staffBuildings } from './staffing.js';
import { buildStaffingTally } from './tally.js';

export { COLLECTOR_TARGET_BY_GOOD_ID, DEFAULT_COLLECTOR_TARGET } from './collectors/index.js';
export { CRAFT_RESTRICTIONS_BY_BUILDING_ID } from './craft.js';
export { FLAG_MAX_DISTANCE_NODES, FLAG_MIN_DISTANCE_NODES } from './flag-spots.js';
export { OPENING_HUNT_UNTIL_BUILDING_ID } from './hunter.js';
export { builderJobOf } from './pool.js';
export { BUILDER_CAP, STAFFING_BY_BUILDING_ID } from './staffing.js';

/**
 * The CollectResources module - the seat's one workforce allocator (user plan). Every adult
 * non-fighter man is classified against the live world, and the wanted roles are drawn out of the
 * spare pool in the priority order the returned array spells out: the essentials first, then the
 * tiers the surplus pays for - collector top-ups and the surplus staffing tier rank behind every
 * target post (user rule: extra collectors and the third farmer are of little use early) - and the
 * garrison sizing last of all (it counts the leftovers into the assistant's training counters
 * instead of claiming a man). No second module ever races this one for a person. A transient conflict
 * with the live world self-heals on the next decision because every target is recomputed from
 * state, never remembered.
 */
function runWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly Command[] {
  const builderJob = builderJobOf(ctx);
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return rebuildCrew(world, ctx, player, builderJob);
  const statuses = entryStatuses(world, ctx, player, order);
  const wanted = wantedCollectorGoods(ctx, order, statuses);
  const { pool, collectorsByGood, genericCollectors, scouts } = classifyWorkforce(world, ctx, player, wanted);
  const force = new SpareForce(pool);
  const tally = buildStaffingTally(world);
  const taken: TakenFlagNodes = new Set();
  return [
    ...allocateCollectors(world, ctx, base, wanted, collectorsByGood, force, taken, builderJob),
    ...allocateOpeningHunter(world, ctx, player, base, force, builderJob),
    ...allocateScout(world, ctx, player, scouts, force, builderJob),
    ...staffBuildings(world, ctx, player, force, tally, 'min'),
    ...reserveBuilders(world, force, builderJob), // construction never starves
    ...staffBuildings(world, ctx, player, force, tally, 'target'),
    ...topUpCollectors(world, ctx, base, wanted, collectorsByGood, force, taken),
    ...staffBuildings(world, ctx, player, force, tally, 'surplus'),
    ...allocateGenericCollectors(world, ctx, base, genericCollectors, force, taken, builderJob),
    ...trainGarrison(world, ctx, player, force),
    ...tuneCraftSelections(world, ctx, player),
  ];
}

/**
 * What a BASELESS seat runs instead of the ladder: the builder reserve, then minimum staffing. The
 * ladder's order is deliberately INVERTED here - a based seat fills its minimums before reserving
 * builders, but with no hub the site is existential and a post is not, and this allocator is the only
 * thing that turns a man into a builder, so covering a vacancy first could leave a one-man seat with
 * nobody to raise the very site that gives it a base back. Minimums still follow, so a raid that
 * takes the hub and the baker together does not freeze the bakery for the whole rebuild.
 */
function rebuildCrew(
  world: World,
  ctx: SystemContext,
  player: number,
  builderJob: number | null,
): readonly Command[] {
  if (!ownedBuildings(world, player).some((e) => world.has(e, UnderConstruction))) return [];
  const force = new SpareForce(rebuildHands(world, ctx, player));
  return [
    ...reserveBuilders(world, force, builderJob),
    ...staffBuildings(world, ctx, player, force, buildStaffingTally(world), 'min'),
  ];
}

/**
 * Every man a baseless seat may put on that site, spare first. Beyond the pool it takes the two
 * classes the based branch would have recycled - a scout has no duty left (both its probes gate on
 * the base) and a generic gatherer is not worth protecting here - and finally men standing at a post,
 * whose binding `setJob` drops. Without those two groups a seat whose few survivors were all
 * classified or employed mints no builder at all and never regains a base.
 *
 * The seat pays for this: converting a gatherer drops its flag (`syncWorkFlagToJob`), so a rebuild
 * that outlives the goods its razed base spilled can idle its own crew for want of materials. A man
 * mid-action is left alone, the scout retire rule.
 */
function rebuildHands(world: World, ctx: SystemContext, player: number): Entity[] {
  const { pool, genericCollectors, scouts } = classifyWorkforce(world, ctx, player, []);
  const posted = ownedSettlers(world, player).filter(
    (e) => world.has(e, JobAssignment) && !world.has(e, CurrentAtomic) && isAllocatableMan(world, ctx, e),
  );
  return [...pool, ...scouts, ...genericCollectors, ...posted];
}

/** The scout hire and retire: the scout exists exactly while either of its duties has work, a missing
 *  signpost or a catchable animal in range (`scout/index.ts`), and an idle scout turns back into a
 *  builder. Only an UNMARRIED man is hired (user rule: a scout is away on a mission and its wife
 *  would wait forever); a married scout already working is retired only through the normal idle path,
 *  never mid-post. A scout mid-action is left alone: `setJob` cancels the running atomic, so retiring
 *  one mid-meal would throw the meal away.
 *
 *  The hire is deliberately blind to the seat's `guideBuild` toggle, which gates only the module that
 *  ORDERS him: this allocator is the one module allowed to claim a settler, so a seat that disables
 *  GuideBuild keeps paying one man for duties nobody issues. */
function allocateScout(
  world: World,
  ctx: SystemContext,
  player: number,
  scouts: readonly Entity[],
  force: SpareForce,
  builderJob: number | null,
): Command[] {
  const commands: Command[] = [];
  const scoutJob = scoutJobType(ctx.content);
  // The trade to keep one settler in, or null when the content declares no scout or neither duty has
  // work. The round-up probes first even though it ranks second: measured on a settled map, a
  // satisfied lattice costs ~970 us to answer null (it has to scan every ring to say so) against
  // ~200 us for the herd scan, so the cheap probe short-circuits the expensive one here.
  const hasScoutWork =
    nextLivestockCatch(world, ctx, player) !== null || nextSignpostTarget(world, ctx, player) !== null;
  const keepScoutAs = scoutJob !== null && hasScoutWork ? scoutJob : null;
  if (keepScoutAs !== null && scouts.length === 0) {
    const spare = force.take((e) => !isMarried(world, e));
    if (spare !== null) commands.push({ kind: 'setJob', entity: spare, jobType: keepScoutAs });
  }
  for (const [i, scout] of scouts.entries()) {
    if (keepScoutAs !== null && i === 0) continue; // the working scout - keep
    if (world.has(scout, CurrentAtomic)) continue;
    if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) continue;
    if (builderJob !== null) commands.push({ kind: 'setJob', entity: scout, jobType: builderJob });
  }
  return commands;
}

/** A module allocating against `order`'s collector gating - parameterized like `buildOrderModule`,
 *  so tests drive it with fixture orders. */
export function workforceModule(order: readonly BuildOrderEntry[]): AiPlayerModule {
  return {
    id: 'collectResources',
    run: (world, ctx, player) => runWorkforce(world, ctx, player, order),
  };
}
