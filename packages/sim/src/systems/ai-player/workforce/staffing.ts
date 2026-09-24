import type { BuildingType } from '@open-northland/data';
import { Building, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { isBuilt, ownedBuildings } from '../seat-roster.js';
import type { SpareForce } from './pool.js';
import { incrementStaffing, type StaffingTally } from './tally.js';

/** A building's staffing plan: workers per operator trade and total transport carriers, filled tier by
 *  tier so everyone's minimum beats anyone's second worker. Slot counts cap every value. */
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

/** The baseline workplace plan: one worker per operator trade, no carrier (authored). */
const DEFAULT_WORKPLACE_STAFFING: BuildingStaffing = {
  operatorMin: 1,
  operatorTarget: 1,
  carrierMin: 0,
  carrierTarget: 0,
};

/** Per-building overrides of {@link DEFAULT_WORKPLACE_STAFFING}, by stable content id (authored),
 *  applied per building instance. A second hand is a target-tier extra unless its row says otherwise,
 *  so a farm knowingly runs on one farmer until men are actually spare. */
export const STAFFING_BY_BUILDING_ID: Readonly<Record<string, Partial<BuildingStaffing>>> = {
  // A lone farmer cannot walk the watering circuit in time, so the second hand is worth more than its
  // own output; the third and fourth only pay off out of genuine surplus.
  work_farm_00: { operatorTarget: 2, operatorSurplus: 4 },
  // Surplus-only: one farm grows roughly what one miller grinds, so the second seat is worth filling
  // only once the farm's own extra hands have outgrown him.
  work_mill_00: { operatorSurplus: 2 },
  work_brewery: { operatorTarget: 2, carrierTarget: 1 },
  // A breeder works a single species line (CRAFT_RESTRICTIONS_BY_BUILDING_ID), so the pair is the
  // minimum that runs the ox and sheep lines at once.
  work_animal_farm: { operatorMin: 2, operatorTarget: 2 },
  // The level-0 bakery offers a single baker slot, so only its carrier is planned.
  work_bakery_00: { carrierMin: 1, carrierTarget: 1 },
  work_bakery_01: { operatorTarget: 2, carrierMin: 1, carrierTarget: 1 },
  work_joinery_01: { operatorTarget: 2 },
  // The second potter only turns crockery (CRAFT_RESTRICTIONS_BY_BUILDING_ID), so he waits for surplus.
  work_pottery_01: { operatorSurplus: 2 },
  work_sewery_01: { operatorTarget: 2 },
  work_smithy_01: { operatorTarget: 2, carrierTarget: 1 },
  work_armory_01: { operatorTarget: 2, carrierTarget: 1 },
  // One herbalist keeps the druids in herbs; a second is worth a man only out of surplus.
  work_herb_hut: { operatorSurplus: 2 },
  work_druid_01: { operatorTarget: 2, carrierTarget: 1 },
  work_coin_mint: { operatorTarget: 2, carrierTarget: 1 },
};

/** The storage plan: the HQ and every warehouse run up to three transport carriers, all at the target
 *  tier (authored), so a warehouse post never comes ahead of workplace staffing or the builder
 *  reserve. */
const STORAGE_STAFFING: BuildingStaffing = {
  operatorMin: 0,
  operatorTarget: 0,
  carrierMin: 0,
  carrierTarget: 3,
};

/** How many builders the pool keeps (authored). Claimed right after minimum staffing, so construction
 *  never starves, and before every top-up tier, so the surplus ladder distributes only what is beyond
 *  the reserve. */
export const BUILDER_CAP = 8;

/** The staffing plan for a building type, or null for the kinds the allocator never staffs: homes,
 *  towers and the barracks are military or residential, not production. */
function staffingOf(type: BuildingType): BuildingStaffing | null {
  if (type.kind === 'storage') return STORAGE_STAFFING;
  if (type.kind !== 'workplace') return null;
  return { ...DEFAULT_WORKPLACE_STAFFING, ...STAFFING_BY_BUILDING_ID[type.id] };
}

/**
 * Staff each built workplace and storage toward its {@link BuildingStaffing} tier, where an operator is
 * a non-carrier, non-gatherer slot. Gatherer slots stay open, and a carrier-only workplace (the well, the
 * hive) fills itself, so it needs no staff. Workplaces fill before storage within a tier, and
 * all tiers advance one shared {@link StaffingTally} because the commands apply only next tick.
 */
export function staffBuildings(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
  tally: StaffingTally,
  tier: StaffingTier,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
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
 * Claim up to {@link BUILDER_CAP} pool men as builders, existing builders first so the crew does not
 * churn. Claiming rather than posting leaves the later tiers only the surplus beyond the reserve; the
 * cap is one-way and never demotes a man.
 */
export function reserveBuilders(world: World, force: SpareForce, builderJob: number | null): PlayerCommand[] {
  if (builderJob === null) return [];
  const commands: PlayerCommand[] = [];
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
