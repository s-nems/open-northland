import { CurrentAtomic, ErectSignpostOrder, PlayerOrder } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildStaffingTally } from '../../economy/jobs/openings.js';
import { isMarried } from '../../family/eligibility.js';
import { scoutJobType } from '../../readviews/index.js';
import { type BuildOrderEntry, entryStatuses } from '../build-order/index.js';
import type { AiPlayerModule } from '../index.js';
import { headquartersOf } from '../shared.js';
import { nextSignpostTarget } from '../signpost-coverage.js';
import {
  allocateCollectors,
  allocateGenericCollectors,
  topUpCollectors,
  wantedCollectorGoods,
} from './collectors/index.js';
import { tuneCraftSelections } from './craft.js';
import type { TakenFlagNodes } from './flag-spots.js';
import { trainGarrison } from './garrison.js';
import { builderJobOf, classifyWorkforce, SpareForce } from './pool.js';
import { reserveBuilders, staffBuildings } from './staffing.js';

export { COLLECTOR_TARGET_BY_GOOD_ID, DEFAULT_COLLECTOR_TARGET } from './collectors/index.js';
export { CRAFT_RESTRICTIONS_BY_BUILDING_ID } from './craft.js';
export { FLAG_MAX_DISTANCE_NODES, FLAG_MIN_DISTANCE_NODES } from './flag-spots.js';
export { GARRISON_TARGET } from './garrison.js';
export { builderJobOf } from './pool.js';
export { BUILDER_CAP, STAFFING_BY_BUILDING_ID } from './staffing.js';

/**
 * The CollectResources module — the seat's one workforce allocator (user plan 2026-07-17, ladder
 * revision 2026-07-25). Every adult non-fighter man is classified against the live world, and the
 * wanted roles are drawn out of the spare pool in the priority order the returned array spells out:
 * the essentials first, then the tiers the surplus pays for, and the garrison last of all. No second
 * module ever races this one for a person. A transient conflict with the live world self-heals on the
 * next decision because every target is recomputed from state, never remembered.
 */
function runWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly Command[] {
  const hq = headquartersOf(world, ctx, player);
  if (hq === null) return [];
  const builderJob = builderJobOf(ctx);
  const statuses = entryStatuses(world, ctx, player, order);
  const wanted = wantedCollectorGoods(ctx, order, statuses);
  const { pool, collectorsByGood, genericCollectors, scouts } = classifyWorkforce(world, ctx, player, wanted);
  const force = new SpareForce(pool);
  const tally = buildStaffingTally(world);
  const taken: TakenFlagNodes = new Set();
  return [
    ...allocateCollectors(world, ctx, hq, wanted, collectorsByGood, force, taken, builderJob),
    ...allocateScout(world, ctx, player, scouts, force, builderJob),
    ...staffBuildings(world, ctx, player, force, tally, 'min'),
    ...reserveBuilders(world, force, builderJob), // construction never starves
    ...topUpCollectors(world, ctx, hq, wanted, collectorsByGood, force, taken),
    ...staffBuildings(world, ctx, player, force, tally, 'target'),
    ...allocateGenericCollectors(world, ctx, hq, genericCollectors, force, taken, builderJob),
    ...trainGarrison(world, ctx, player, force),
    ...tuneCraftSelections(world, ctx, player),
  ];
}

/** The scout hire and retire: the scout exists exactly while signpost work remains — an idle scout turns back into a
 *  builder; the lattice calls one up again when a post is missing. Only an UNMARRIED man is hired
 *  (user rule 2026-07-25 — a scout is away on a mission and its wife would wait forever); a married
 *  scout already working is retired only through the normal idle path, never mid-post. A scout
 *  mid-action is left alone: `setJob` cancels the running atomic, so retiring one mid-meal would
 *  throw the meal away (see signpost-coverage.ts). */
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
  // The trade to keep one settler in, or null when the content declares no scout or no post is missing.
  const keepScoutAs = scoutJob !== null && nextSignpostTarget(world, ctx, player) !== null ? scoutJob : null;
  if (keepScoutAs !== null && scouts.length === 0) {
    const spare = force.take((e) => !isMarried(world, e));
    if (spare !== null) commands.push({ kind: 'setJob', entity: spare, jobType: keepScoutAs });
  }
  for (const [i, scout] of scouts.entries()) {
    if (keepScoutAs !== null && i === 0) continue; // the working scout — keep
    if (world.has(scout, CurrentAtomic)) continue;
    if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) continue;
    if (builderJob !== null) commands.push({ kind: 'setJob', entity: scout, jobType: builderJob });
  }
  return commands;
}

/** A module allocating against `order`'s collector gating — parameterized like `buildOrderModule`,
 *  so tests drive it with fixture orders. */
export function workforceModule(order: readonly BuildOrderEntry[]): AiPlayerModule {
  return {
    id: 'collectResources',
    run: (world, ctx, player) => runWorkforce(world, ctx, player, order),
  };
}
