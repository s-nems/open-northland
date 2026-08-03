import type { BuildingType } from '@open-northland/data';
import { Building, Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { isBuilt, ownedBuildings } from '../shared.js';
import type { SpareForce } from './pool.js';
import { incrementStaffing, type StaffingTally } from './tally.js';

/** A building's staffing plan: workers per OPERATOR trade and TOTAL transport carriers, read tier
 *  by tier (everyone's minimum beats anyone's second worker, targets before any surplus seat). Slot
 *  counts cap every value. */
export interface BuildingStaffing {
  readonly operatorMin: number;
  readonly operatorTarget: number;
  /** Operators filled only by the `surplus` pass. Absent: the target count is final. */
  readonly operatorSurplus?: number;
  readonly carrierMin: number;
  readonly carrierTarget: number;
}

/** Whichever tier a staffing pass fills toward - see {@link staffBuildings}. */
export type StaffingTier = 'min' | 'target' | 'surplus';

/** The baseline workplace plan: one worker per operator trade, no carrier (user plan - a
 *  carrier-only utility like the well stays a self-served shared facility). */
const DEFAULT_WORKPLACE_STAFFING: BuildingStaffing = {
  operatorMin: 1,
  operatorTarget: 1,
  carrierMin: 0,
  carrierTarget: 0,
};

/** Per-building overrides of {@link DEFAULT_WORKPLACE_STAFFING}, by stable content id. They apply per
 *  building instance, so a second bakery gets the same plan as the first, and a second hand is a
 *  target-tier extra unless its row says otherwise. Authored balance throughout. */
export const STAFFING_BY_BUILDING_ID: Readonly<Record<string, Partial<BuildingStaffing>>> = {
  // A lone farmer cannot walk the watering circuit in time, so the second hand is worth more than its
  // own output; the third and fourth only pay off out of genuine surplus.
  work_farm_00: { operatorTarget: 2, operatorSurplus: 4 },
  // Surplus-only: one farm grows roughly what one miller grinds, so the second seat is worth filling
  // only once the farm's own extra hands have outgrown him. Approximation.
  work_mill_00: { operatorSurplus: 2 },
  work_brewery: { operatorTarget: 2, carrierTarget: 1 },
  // The one building whose SECOND operator is a minimum: a breeder works a single species line
  // (see CRAFT_RESTRICTIONS_BY_BUILDING_ID), so the pair is what runs the ox and sheep lines at
  // once. One breeder still works both, just serially.
  work_animal_farm: { operatorMin: 2, operatorTarget: 2 },
  // The level-0 bakery has a single baker slot - only its carrier is planned; the two-baker
  // target belongs to the level-2 tier, which actually offers the seats.
  work_bakery_00: { carrierMin: 1, carrierTarget: 1 },
  work_bakery_01: { operatorTarget: 2, carrierMin: 1, carrierTarget: 1 },
  // The seat's only iron-tool shop (see CRAFT_RESTRICTIONS_BY_BUILDING_ID) - its second joiner
  // doubles tool output once the settlement can spare the man.
  work_joinery_01: { operatorTarget: 2 },
  work_sewery_01: { operatorTarget: 2 },
  work_smithy_01: { operatorTarget: 2, carrierTarget: 1 },
  work_armory_01: { operatorTarget: 2, carrierTarget: 1 },
};

/** The storage plan - the HQ and every warehouse run up to three transport carriers, all at the
 *  TARGET tier (user rule: a warehouse post is a convenience the settlement buys out of
 *  genuinely spare men, never ahead of workplace staffing or the builder reserve). Their
 *  fisher/hunter/collector slots stay open (the storage-staffs-transport-only rule in
 *  {@link staffBuildings} - not every such slot classifies as a harvest trade). */
const STORAGE_STAFFING: BuildingStaffing = {
  operatorMin: 0,
  operatorTarget: 0,
  carrierMin: 0,
  carrierTarget: 3,
};

/** The builder reserve: the pool keeps up to this many builders (user plan - "8 builders max").
 *  Claimed right after minimum staffing, so construction never starves, and before every top-up
 *  tier, so the reserve is what the surplus ladder distributes BEYOND. */
export const BUILDER_CAP = 8;

/** The staffing plan for a building type, or null for the kinds the allocator never staffs - homes,
 *  towers and the barracks are military or residential, not production the plan crews. */
function staffingOf(type: BuildingType): BuildingStaffing | null {
  if (type.kind === 'storage') return STORAGE_STAFFING;
  if (type.kind !== 'workplace') return null;
  return { ...DEFAULT_WORKPLACE_STAFFING, ...STAFFING_BY_BUILDING_ID[type.id] };
}

/**
 * The staffing passes (min, target, then surplus): staff each built workplace and storage toward its
 * {@link BuildingStaffing} tier, where "operator" is a non-carrier, non-gatherer slot. Gatherer
 * slots are never staffed, so a carrier-only workplace (the well, the hive) gets no permanent
 * worker: it is a shared utility a consumer self-serves (a baker cranks the well for its own water,
 * see settlers/drives/economy/workshop).
 * Within a tier, every WORKPLACE fills before any storage (the plan lists warehouse carriers below
 * workshop staffing), each kind in canonical building order; all tiers advance ONE shared
 * {@link StaffingTally} per decision (commands apply next tick, so a later pass must see the earlier
 * passes' claims). Once the pool runs dry the rest waits for grown sons (user rule).
 */
export function staffBuildings(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
  tally: StaffingTally,
  tier: StaffingTier,
): Command[] {
  const commands: Command[] = [];
  const index = contentIndex(ctx.content);
  const owned = ownedBuildings(world, player);
  const ordered = [
    ...owned.filter((e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === 'workplace'),
    ...owned.filter((e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === 'storage'),
  ];
  for (const building of ordered) {
    if (!isBuilt(world, building)) continue;
    const type = index.buildings.get(world.get(building, Building).buildingType);
    if (type === undefined) continue;
    const staffing = staffingOf(type);
    if (staffing === null) continue;
    const operatorWant =
      tier === 'min'
        ? staffing.operatorMin
        : tier === 'target'
          ? staffing.operatorTarget
          : (staffing.operatorSurplus ?? staffing.operatorTarget);
    const carrierWant = tier === 'min' ? staffing.carrierMin : staffing.carrierTarget;
    for (const slot of type.workers) {
      const carrier = isCarrierJob(ctx, slot.jobType);
      if (!carrier && index.harvestJobs.has(slot.jobType)) continue; // gatherer slots stay open
      if (type.kind === 'storage' && !carrier) continue; // storage staffs transport only
      const want = Math.min(slot.count, carrier ? carrierWant : operatorWant);
      const held = tally.get(building)?.get(slot.jobType) ?? 0;
      for (let i = held; i < want; i++) {
        const spare = force.take();
        if (spare === null) return commands; // pool dry - the rest waits for grown sons
        commands.push({ kind: 'assignWorker', entity: spare, building, jobPriority: [slot.jobType] });
        incrementStaffing(tally, building, slot.jobType);
      }
    }
  }
  return commands;
}

/**
 * The builder reserve: CLAIM up to {@link BUILDER_CAP} pool men - existing builders first (no
 * churn), then conversions. Because the men are claimed, the tiers behind this phase distribute only
 * the surplus BEYOND the reserve, so construction keeps its crew while the settlement staffs up. Men
 * left over once every phase has drawn keep their current trade (idle civilians) until a post opens -
 * the cap is one-way, never a demotion.
 */
export function reserveBuilders(world: World, force: SpareForce, builderJob: number | null): Command[] {
  if (builderJob === null) return [];
  const commands: Command[] = [];
  let builders = 0;
  while (builders < BUILDER_CAP) {
    const keep = force.take((e) => world.get(e, Settler).jobType === builderJob);
    if (keep === null) break;
    builders++;
  }
  while (builders < BUILDER_CAP) {
    const spare = force.take();
    if (spare === null) break;
    commands.push({ kind: 'setJob', entity: spare, jobType: builderJob });
    builders++;
  }
  return commands;
}
