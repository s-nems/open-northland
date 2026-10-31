import type { BuildingType } from '@open-northland/data';
import { playerPlacementTribes, professionProgressionEnabled, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { goodEnabled, jobEnabled, typeAllowed } from '../../progression/index.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';
import { isCarrierJob } from '../../stores/index.js';
import { LATE_GAME_FROM_TICKS } from '../game-phase.js';

/** A building's staffing plan: workers per operator trade and total transport carriers, filled tier by
 *  tier so everyone's minimum beats anyone's second worker. Slot counts cap every value. */
export interface BuildingStaffing {
  readonly operatorMin: number;
  readonly operatorTarget: number;
  /** Operators filled only by the `surplus` pass. Absent: the target count is final. */
  readonly operatorSurplus?: number;
  readonly carrierMin: number;
  readonly carrierTarget: number;
  /** Carriers filled only by the `surplus` pass, and the count a release keeps. Absent: the target count
   *  is final. */
  readonly carrierSurplus?: number;
}

/** The baseline workplace plan: one worker per operator trade, no carrier (authored). */
const DEFAULT_WORKPLACE_STAFFING: BuildingStaffing = {
  operatorMin: 1,
  operatorTarget: 1,
  carrierMin: 0,
  carrierTarget: 0,
};

/** A row's tiers plus the floor a product gate keeps. */
interface StaffingTiers extends Partial<BuildingStaffing> {
  /** The operators a product gate never cuts the crew below, the tiers permitting; default
   *  {@link DEFAULT_GATE_FLOOR}. */
  readonly gateFloor?: number;
}

/** The product gate keeps at least the first craftsman. */
const DEFAULT_GATE_FLOOR = 1;

/** One {@link STAFFING_BY_BUILDING_ID} row. */
export interface StaffingRow extends StaffingTiers {
  /** The minimum and target tiers' operators beyond the first are posts only while one of the type's
   *  products with supply lines (`SeatSupply`) is short: under its comfort line while one man or
   *  none works there, under its glut line while more do, one operator more per supply unit it lacks to
   *  its comfort line (`gatedOperators`). The surplus tier is gated the same way, except that it
   *  keeps the row's count while a good the type's craft plan caps at an authored glut lies under that
   *  glut (`craftGlutPending`): a spare hand works the goods no supply line sizes. */
  readonly productGated?: true;
  /** The tiers from the late game ({@link LATE_GAME_FROM_TICKS}) on, over the rest of the row. */
  readonly late?: StaffingTiers;
  /** A discovery until which the building keeps one operator: a discovery's experience counts on one
   *  man, so a second hand would halve the first one's share of the work. */
  readonly aloneUntil?: DiscoveryTarget;
  /** A discovery until which the building runs a carrier at the minimum tier, so its operator works
   *  instead of fetching his inputs and earns it sooner. */
  readonly porterUntil?: DiscoveryTarget;
  /** The tiers on a seat dressing its army in tunics (`TUNIC_SIDES`, `../build-order/seat-order.ts`), over the rest of the row. */
  readonly tunicSeat?: Partial<BuildingStaffing>;
}

/** A job or good the seat discovers, by stable content id. */
export interface DiscoveryTarget {
  readonly kind: 'job' | 'good';
  readonly id: string;
}

const BIG_HEALING_POTION: DiscoveryTarget = { kind: 'good', id: 'potion_heal_big' };

/** Per-building overrides of {@link DEFAULT_WORKPLACE_STAFFING}, by stable content id (authored),
 *  applied per building instance. A second hand is a target-tier extra unless its row says otherwise,
 *  so a farm knowingly runs on one farmer until men are actually spare. A workshop's product lines, not
 *  its row, decide when it rests (`productsRest`). */
export const STAFFING_BY_BUILDING_ID: Readonly<Record<string, StaffingRow>> = {
  // One farmer while the grain keeps up. Short of it, one more per unit it lacks: a lone farmer cannot walk
  // the watering circuit in time, so the second hand comes at the target tier, and the third and fourth,
  // which only pay off out of genuine surplus, from the surplus tier. The crew shrinks to its first
  // farmer at the grain's glut.
  work_farm_00: { operatorTarget: 2, operatorSurplus: 4, productGated: true, late: { gateFloor: 2 } },
  // One miller while the flour keeps up; one farm grows roughly what one miller grinds, so the second seat
  // is worth filling only out of surplus and only while the flour runs short.
  // Owner ruling: a porter feeds the miller wheat until the bakery's baker is earned.
  work_mill_00: { operatorSurplus: 2, productGated: true, porterUntil: { kind: 'job', id: 'baker' } },
  // Owner ruling: the vikings live on mead, so the brewery's second brewer is a minimum post.
  work_brewery: { operatorMin: 2, operatorTarget: 2, carrierTarget: 1 },
  // Both breeders keep the cattle (CRAFT_PLANS_BY_BUILDING_ID), or a tunic seat's one cattle and one
  // sheep, so the pair works from the start. Owner ruling: a porter feeds them wheat and water, at the
  // target tier: as a minimum post with the tailors' and the joinery's it left a krwawa_rzeka seat of
  // 35-45 settlers 2-6 builders at game minute 20 and 7-13 at 60 (12-15 without them).
  work_animal_farm: { operatorMin: 2, operatorTarget: 2, carrierTarget: 1 },
  // The level-0 bakery offers a single baker slot, so only its carrier is planned.
  work_bakery_00: { carrierMin: 1, carrierTarget: 1 },
  // Owner ruling: an upgraded bakery runs its full crew before the seat raises another.
  work_bakery_01: { operatorMin: 2, operatorTarget: 2, carrierMin: 1, carrierTarget: 1 },
  // The tools joinery runs two joiners and a carrier. Owner ruling: the handcarts' joinery runs its carrier
  // as a minimum post, since a joiner fetches a cart's bill from his own shelves first and the carts speed
  // every haul, and fills its third joiner slot, since iron tools and handcarts are always short.
  work_joinery_01: { operatorTarget: 2, carrierTarget: 1 },
  work_joinery_02: { operatorTarget: 3, carrierMin: 1, carrierTarget: 1 },
  work_joinery_03: { operatorTarget: 3, carrierTarget: 1 },
  // The first potter and mason work alone, so a carrier hauls for them once the builder reserve is full.
  // The upgraded tiers keep one only while their goods run short (SUPPLY_CARRIER_GOODS_BY_BUILDING_ID),
  // except that from the late game the pottery runs one whenever clay is not short (rawGoodShort), since
  // bricks bottleneck the late bills. The
  // pottery's second potter is a minimum post, ahead of the builder reserve, while a building material
  // runs short once the opening run is done, and a surplus post meanwhile, making the crockery.
  work_pottery_00: { carrierTarget: 1 },
  work_mason_hut_00: { carrierTarget: 1 },
  work_pottery_01: {
    operatorMin: 2,
    operatorTarget: 2,
    operatorSurplus: 2,
    productGated: true,
    late: { carrierTarget: 1 },
  },
  work_mason_hut_01: { operatorTarget: 2, productGated: true },
  // Owner ruling: each tailor runs a porter at the target tier, as the animal farm does, and a tunic
  // seat's upper tailor its second tailor as a minimum post, so its two shops' four tailors stand early.
  work_sewery_00: { carrierTarget: 1 },
  work_sewery_01: { operatorTarget: 2, carrierTarget: 1, tunicSeat: { operatorMin: 2 } },
  // A porter fetches the lower smith's iron and wood until chain mail, which opens the upper tier, is
  // earned, so he forges rather than walks: a lone smith forging about a piece every two to three minutes
  // took 20-30 game minutes for its ten forgings (diamentowa_dolina, magiczny_las).
  work_smithy_00: { porterUntil: { kind: 'good', id: 'armor_chain' } },
  // Owner ruling: the upgraded smithy's two smiths split the core arms between them, so the second is a
  // minimum post; another smithy rises only once the standing ones are fully crewed.
  work_smithy_01: { operatorMin: 2, operatorTarget: 2, carrierTarget: 1 },
  // Owner ruling: one upgraded armoury with two armourers and a porter arms the seat for most of the game,
  // so its whole crew are minimum posts.
  work_armory_01: { operatorMin: 2, operatorTarget: 2, carrierMin: 1, carrierTarget: 1 },
  // One herbalist keeps the early druids in herbs, and a second is worth a man only out of surplus. The
  // late game's druid huts take the hut's three: two at the target tier, the third out of surplus.
  work_herb_hut: { operatorSurplus: 2, late: { operatorTarget: 2, operatorSurplus: 3 } },
  // Owner ruling: one druid earns the big healing potion alone, more brew once it is earned. Until then
  // both huts run a porter: the oil he trains on takes a mushroom a brew, and without one the druid
  // averaged a brew in 75 seconds against the recipe's 15, his mushroom shelf empty (magiczny_las).
  work_druid_00: { porterUntil: BIG_HEALING_POTION },
  work_druid_01: {
    operatorTarget: 2,
    carrierTarget: 1,
    aloneUntil: BIG_HEALING_POTION,
    porterUntil: BIG_HEALING_POTION,
  },
  // Owner ruling: the first coiner earns the amulets alone, his coins feeding the druids meanwhile.
  work_coin_mint: {
    operatorTarget: 2,
    carrierTarget: 1,
    aloneUntil: { kind: 'good', id: 'amulet_strength' },
  },
  // The well and the hive stay unstaffed: the brewery's carrier draws its water and honey himself.
};

/** The operators a workplace type's plan staffs at the target tier, each operator trade capped by its
 *  slot count; 0 for any other kind. */
export function plannedOperators(ctx: SystemContext, type: BuildingType): number {
  if (type.kind !== 'workplace') return 0;
  const want = rowPlan(ctx, type).plan.operatorTarget;
  const index = contentIndex(ctx.content);
  let operators = 0;
  for (const slot of type.workers) {
    if (isCarrierJob(ctx, slot.jobType) || index.harvestJobs.has(slot.jobType)) continue;
    operators += Math.min(slot.count, want);
  }
  return operators;
}

/** The operators a workplace of `type` holds with its full crew for `player`'s seat: the target tier's
 *  ({@link plannedOperators}), one while it earns the discovery its row keeps it alone for. */
export function fullCrew(world: World, ctx: SystemContext, player: number, type: BuildingType): number {
  const planned = plannedOperators(ctx, type);
  return discoveryPending(world, ctx, player, STAFFING_BY_BUILDING_ID[type.id]?.aloneUntil)
    ? Math.min(planned, 1)
    : planned;
}

/** The operators bound to `building`: carriers and gatherers left out. */
export function crewAt(world: World, ctx: SystemContext, building: Entity): number {
  const index = contentIndex(ctx.content);
  let crew = 0;
  for (const e of assignedWorkers(world, building)) {
    const job = world.tryGet(e, Settler)?.jobType ?? null;
    if (job !== null && !isCarrierJob(ctx, job) && !index.harvestJobs.has(job)) crew++;
  }
  return crew;
}

export interface RowPlan {
  readonly plan: BuildingStaffing;
  readonly gateFloor: number;
}

/** A workplace type's row at the decision's tick, over the default plan. Shared, never edited. */
export function rowPlan(ctx: SystemContext, type: BuildingType): RowPlan {
  let plans = rowPlansByType.get(type);
  if (plans === undefined) {
    plans = { early: deriveRowPlan(type, false), late: deriveRowPlan(type, true) };
    rowPlansByType.set(type, plans);
  }
  return ctx.tick >= LATE_GAME_FROM_TICKS ? plans.late : plans.early;
}

function deriveRowPlan(type: BuildingType, lateGame: boolean): RowPlan {
  const {
    productGated: _,
    aloneUntil: __,
    porterUntil: ___,
    tunicSeat: ____,
    late,
    ...row
  } = STAFFING_BY_BUILDING_ID[type.id] ?? {};
  const { gateFloor, ...tiers } = {
    gateFloor: DEFAULT_GATE_FLOOR,
    ...row,
    ...(late !== undefined && lateGame ? late : {}),
  };
  return { plan: { ...DEFAULT_WORKPLACE_STAFFING, ...tiers }, gateFloor };
}

/** {@link rowPlan} per content building type, before and from the late game: the rows are authored
 *  constants, so the plans are content-static. */
const rowPlansByType = new WeakMap<BuildingType, { readonly early: RowPlan; readonly late: RowPlan }>();

/** Whether the seat may still make the `target` discovery under the experience gates and has not yet;
 *  false with no target, with the gates off, for a banned one or one the content lacks. */
export function discoveryPending(
  world: World,
  ctx: SystemContext,
  player: number,
  target: DiscoveryTarget | undefined,
): boolean {
  if (target === undefined || !professionProgressionEnabled(world)) return false;
  const index = contentIndex(ctx.content);
  const typeId = (target.kind === 'job' ? index.jobTypeBySlug : index.goodTypeBySlug).get(target.id);
  const tribe = playerPlacementTribes(world, player)?.[0];
  if (
    typeId === undefined ||
    tribe === undefined ||
    !typeAllowed(world, ctx, player, tribe, target.kind, typeId)
  )
    return false;
  return target.kind === 'job'
    ? !jobEnabled(world, ctx, player, tribe, typeId)
    : !goodEnabled(world, ctx, player, tribe, typeId);
}
