import { Building, Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildStaffingTally } from '../../economy/jobs/openings.js';
import { isCarrierJob } from '../../stores/index.js';
import { isBuilt, ownedBuildings } from '../shared.js';
import type { SpareForce } from './pool.js';

/** Buildings staffed with a transport carrier on top of their operators, by stable content id
 *  (user plan 2026-07-18: the bakery gets a carrier; the upgraded tier keeps it). */
export const CARRIER_STAFFED_BUILDING_IDS: readonly string[] = ['work_bakery_00', 'work_bakery_01'];

/** Carriers assigned per carrier-staffed building (the plan assigns one). */
export const CARRIERS_PER_STAFFED_BUILDING = 1;

/** Workers assigned per (workplace, trade): the user's opening plan staffs each workshop with one
 *  worker per trade (e.g. a single farmer), even when the building offers more slots. */
export const WORKERS_PER_TRADE = 1;

/** Per-building overrides of {@link WORKERS_PER_TRADE}, by stable content id (user plan
 *  2026-07-18: the upgraded bakery runs two bakers; upgraded pottery/mason keep one worker). */
export const OPERATORS_PER_TRADE_BY_BUILDING_ID: Readonly<Record<string, number>> = {
  work_bakery_01: 2,
};

/**
 * Phase 3: staff each built workplace with one worker per operator trade — where "operator" is a
 * non-carrier, non-gatherer slot. Carrier and gatherer slots are never staffed by default, so a
 * carrier-only workplace (the well, the hive) gets no permanent worker: it is a shared utility a
 * consumer self-serves (a baker cranks the well for its own water, see agents/economy/workshop). The
 * {@link CARRIER_STAFFED_BUILDING_IDS} exceptions add one transport slot on top of their operators;
 * {@link OPERATORS_PER_TRADE_BY_BUILDING_ID} overrides the per-trade worker count. Slots are filled
 * from the spare pool in the canonical building order; once the pool runs dry the rest waits for grown
 * sons (user rules 2026-07-18).
 */
export function staffWorkplaces(
  world: World,
  ctx: SystemContext,
  hq: Entity,
  player: number,
  force: SpareForce,
): Command[] {
  const commands: Command[] = [];
  const index = contentIndex(ctx.content);
  const tally = buildStaffingTally(world);
  for (const building of ownedBuildings(world, player)) {
    if (building === hq || !isBuilt(world, building)) continue;
    const type = index.buildings.get(world.get(building, Building).buildingType);
    if (type === undefined || type.kind !== 'workplace') continue;
    const operators = type.workers.filter(
      (w) => !isCarrierJob(ctx, w.jobType) && !index.harvestJobs.has(w.jobType),
    );
    const carriers = CARRIER_STAFFED_BUILDING_IDS.includes(type.id)
      ? type.workers.filter((w) => isCarrierJob(ctx, w.jobType))
      : [];
    const operatorCap = OPERATORS_PER_TRADE_BY_BUILDING_ID[type.id] ?? WORKERS_PER_TRADE;
    for (const [slot, cap] of [
      ...operators.map((s) => [s, operatorCap] as const),
      ...carriers.map((s) => [s, CARRIERS_PER_STAFFED_BUILDING] as const),
    ]) {
      const held = tally.get(building)?.get(slot.jobType) ?? 0;
      const want = Math.min(slot.count, cap);
      for (let i = held; i < want; i++) {
        const spare = force.take();
        if (spare === null) return commands; // pool dry — the rest waits for grown sons
        commands.push({ kind: 'assignWorker', entity: spare, building, jobPriority: [slot.jobType] });
      }
    }
  }
  return commands;
}

/** Phase 4, the total reset: every still-unclaimed pool man of any other trade becomes a builder. */
export function resetPoolToBuilders(world: World, force: SpareForce, builderJob: number | null): Command[] {
  if (builderJob === null) return [];
  const commands: Command[] = [];
  for (const e of force.remaining()) {
    if (world.get(e, Settler).jobType === builderJob) continue;
    commands.push({ kind: 'setJob', entity: e, jobType: builderJob });
  }
  return commands;
}
