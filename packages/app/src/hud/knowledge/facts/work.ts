import {
  CARRIER_WALK_RANGE_NODES,
  components,
  DEFAULT_NODE_ROUGHNESS,
  PRODUCTION_COUNT_MAX,
  ROAD_RESISTANCE,
  SIGNPOST_LINK_RANGE_NODES,
  systems,
  TRADE_ROUTE_HOUSES,
  WALK_RANGE_NODES,
} from '@open-northland/sim';
import { VIKING } from '../../../catalog/buildings.js';
import {
  FARM_FIELD_RADIUS,
  FARM_MAX_FIELDS,
  FIELD_GROWTH_STAGES,
  WHEAT_WORK_REPEATS,
} from '../../../catalog/farming.js';
import { WOOD_YIELD_PER_NODE } from '../../../catalog/felling.js';
import {
  JOB_BUILDER,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_FARMER,
  JOB_FISHER,
  JOB_HERBALIST,
} from '../../../catalog/jobs.js';
import { STAR_FULL, STAR_TIER_STEP } from '../../../view/projections/experience-stars.js';
import type { KnowledgeBase } from '../model.js';
import {
  buildingOf,
  clipOf,
  clipSeconds,
  diagonal,
  drillSeconds,
  equipOf,
  type Fact,
  type FactReader,
  type FactValue,
  fixedOneDecimal,
  formatted,
  goodTypeOf,
  lessonSeconds,
  oneDecimal,
  PERCENT,
  QUOTED_EXPERIENCE_PCT,
  seconds,
  stockOf,
  trackFacts,
  trackOf,
  twoDecimals,
  vehicleOf,
  vehiclePace,
  weaponRow,
  whole,
} from './reader.js';

/** The experience percents a builder's swing gains a point at, the rows of the construction table. */
const BUILD_SAMPLES_PCT = [0, 10, 22, 50, 79, 90] as const;

/** A cart's unit is lifted twice: into the cart and out of it. */
const LIFTS_PER_UNIT = 2;

/** The hold fills, in percent, the cart load table shows a row of. */
const CART_FILL_SAMPLES_PCT = [0, 25, 50, 75, 100] as const;

/** The ticks the walking table's two weight rows add to a step. */
const LOW_ROW_TICKS = 1;

const HIGH_ROW_TICKS = 2;

/** The combined weights the walking table's two rows open at. */
const LOW_STEP_WEIGHT = LOW_ROW_TICKS * systems.EQUIPMENT_WEIGHT_PER_STEP_TICK;

const HIGH_STEP_WEIGHT = HIGH_ROW_TICKS * systems.EQUIPMENT_WEIGHT_PER_STEP_TICK;

/** The heaviest load of a walking table row that opens at `from`: the next row's opening, less one. */
const rowTop = (from: number): number => from + systems.EQUIPMENT_WEIGHT_PER_STEP_TICK - 1;

const fixedTwoDecimals = formatted(2, 2);

const groundRoughness = (base: KnowledgeBase, ground: string): FactValue =>
  base.content.trianglePatternTypes.find((row) => row.debugName === ground)?.moveResistance;

/** A step's seconds on `ground` for a shod walker, changed by `over`. */
function stepAt(roughness: FactValue, over: Partial<typeof systems.UNMODIFIED_STEP> = {}): FactValue {
  if (roughness === undefined) return undefined;
  return seconds(systems.walkStepTicks(roughness, { ...systems.UNMODIFIED_STEP, shoes: true, ...over }));
}

/** What `over` adds to a shod step on common land, in seconds. */
const stepExtra = (over: Partial<typeof systems.UNMODIFIED_STEP>): number =>
  (stepAt(DEFAULT_NODE_ROUGHNESS, over) ?? 0) - (stepAt(DEFAULT_NODE_ROUGHNESS) ?? 0);

const shoeSteps = (base: KnowledgeBase, roughness: FactValue): FactValue => {
  const uses = equipOf(base, 'shoes')?.uses;
  return uses === undefined || roughness === undefined ? undefined : Math.ceil(uses / roughness);
};

const roadSaving = (base: KnowledgeBase, ground: string): FactValue => {
  const road = stepAt(ROAD_RESISTANCE);
  const off = stepAt(groundRoughness(base, ground));
  return road === undefined || off === undefined ? undefined : PERCENT * (1 - road / off);
};

function courseSeconds(base: KnowledgeBase, good: string): FactValue {
  const goodType = goodTypeOf(base, good);
  if (goodType === undefined) return undefined;
  const amount = base.goodRequirements.get(goodType)?.find((row) => row.route === 'train')?.amount;
  return amount === undefined ? undefined : lessonSeconds(base, amount);
}

/** A good's or a job's practice requirement, in repeats of its track. */
const goodNeed = (base: KnowledgeBase, good: string): FactValue => {
  const goodType = goodTypeOf(base, good);
  if (goodType === undefined) return undefined;
  return base.goodRequirements.get(goodType)?.find((row) => row.route === 'need')?.amount;
};

const jobNeed = (base: KnowledgeBase, job: string): FactValue =>
  base.jobById.get(job)?.requirements.find((row) => row.route === 'need')?.amount;

const TOOLS = [
  ['bare', null],
  ['wooden', 'tool_wooden'],
  ['iron', 'tool_iron'],
] as const;

const workFactor = (base: KnowledgeBase, tool: string | null): FactValue =>
  tool === null ? systems.BARE_HANDS_WORK_FACTOR_PCT : equipOf(base, tool)?.workFactorPct;

function strokes(base: KnowledgeBase, track: string, pct: number, tool: string | null): FactValue {
  const repeats = trackOf(base, track)?.baseRepeatCounter;
  const factor = workFactor(base, tool);
  return repeats === undefined || factor === undefined
    ? undefined
    : systems.strokesPerUnit(repeats, pct, factor);
}

function toolBonus(base: KnowledgeBase, tool: string): number {
  const toolPct = equipOf(base, tool)?.productionBonusPct ?? 0;
  return systems.toolBonusTenths(toolPct) / systems.OUTPUT_TENTHS_PER_UNIT;
}

/** How long `repeats` plays of `good`'s harvest clip take `jobType`. */
function harvestSeconds(base: KnowledgeBase, good: string, jobType: number, repeats: FactValue): FactValue {
  const atomic = base.content.goods.find((row) => row.id === good)?.atomics.harvest;
  const clip = atomic === undefined ? undefined : clipSeconds(base, atomic, jobType);
  return clip === undefined || repeats === undefined ? undefined : clip * repeats;
}

/** One fish at a novice's casts: each cast but the last ends on the failed clip, the last on the catch. */
function fishSeconds(base: KnowledgeBase): FactValue {
  const casts = trackOf(base, 'fisher_general')?.baseRepeatCounter;
  const cast = clipSeconds(base, systems.FISH_CAST_ATOMIC, JOB_FISHER);
  const failed = clipSeconds(base, systems.FISH_FAILED_ATOMIC, JOB_FISHER);
  const caught = clipSeconds(base, systems.FISH_CAUGHT_ATOMIC, JOB_FISHER);
  if (casts === undefined || cast === undefined || failed === undefined || caught === undefined)
    return undefined;
  return casts * cast + (casts - 1) * failed + caught;
}

/** How many trees a novice fells before an iron tool wears out. */
function ironToolTrees(base: KnowledgeBase): FactValue {
  const uses = equipOf(base, 'tool_iron')?.uses;
  const perTree = strokes(base, 'collector_wood', 0, 'tool_iron');
  return uses === undefined || perTree === undefined ? undefined : Math.floor(uses / perTree);
}

/**
 * The one-way route on which a handcart and an ox cart move the same goods in the same time: both shod
 * pullers go out full and come back empty, so the handcart's lift lead is spent on the ox cart's pace.
 */
function cartParRoute(base: KnowledgeBase, roughness: FactValue): FactValue {
  const handcart = vehicleOf(base, 'handcart')?.stockSlots;
  const oxcart = vehicleOf(base, 'oxcart')?.stockSlots;
  const handcartLift = cartLiftSeconds(base, 'handcart');
  const oxcartLift = cartLiftSeconds(base, 'oxcart');
  const empty = stepAt(roughness);
  const handcartFull = stepAt(roughness, { cartSpeedLossPercent: systems.HANDCART_FULL_SPEED_LOSS_PERCENT });
  const oxcartFull = stepAt(roughness, { cartSpeedLossPercent: systems.DRAWN_CART_FULL_SPEED_LOSS_PERCENT });
  if (
    handcart === undefined ||
    oxcart === undefined ||
    handcartLift === undefined ||
    oxcartLift === undefined ||
    empty === undefined ||
    handcartFull === undefined ||
    oxcartFull === undefined
  ) {
    return undefined;
  }
  const liftLead = LIFTS_PER_UNIT * (oxcartLift - handcartLift);
  return liftLead / ((handcartFull + empty) / handcart - (oxcartFull + empty) / oxcart);
}

export const BUILD_TABLE_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
  BUILD_SAMPLES_PCT.flatMap((pct) =>
    TOOLS.map(([name, tool]) => [
      `build.perUnit.${pct}.${name}`,
      whole((base) => {
        const points = buildPoints(base, pct, tool);
        return points === undefined ? undefined : Math.ceil(systems.STEPS_PER_UNIT / points);
      }),
    ]),
  ),
);

/** A novice's strokes and casts per unit with each tool, and the pieces a tool adds to every cycle. */
export const TOOL_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
  TOOLS.flatMap(([name, tool]) => [
    [`tool.strokes.${name}`, whole((base) => strokes(base, 'collector_wood', 0, tool))],
    [`tool.casts.${name}`, whole((base) => strokes(base, 'fisher_general', 0, tool))],
    ...(tool === null ? [] : [[`tool.bonus.${name}`, fixedOneDecimal((base) => toolBonus(base, tool))]]),
  ]),
);

function buildPoints(base: KnowledgeBase, pct: number, tool: string | null): FactValue {
  const factor = workFactor(base, tool);
  return factor === undefined ? undefined : systems.buildStepsPerSwing(pct, factor);
}

/** The first experience percent at which a bare-handed builder's swing installs more than a novice's. */
function bareSwingGainPct(base: KnowledgeBase): FactValue {
  const novice = buildPoints(base, 0, null);
  if (novice === undefined) return undefined;
  for (let pct = 1; pct <= PERCENT; pct++) if ((buildPoints(base, pct, null) ?? 0) > novice) return pct;
  return undefined;
}

/** The points a first home's bill comes to. */
const homeBillPoints: FactReader = (base) => {
  const cost = buildingOf(base, 'home_level_00')?.cost;
  return cost?.reduce((units, row) => units + row.amount, 0);
};

const homeSwings = (base: KnowledgeBase, pct: number, tool: string | null): FactValue => {
  const units = homeBillPoints(base);
  const points = buildPoints(base, pct, tool);
  return units === undefined || points === undefined
    ? undefined
    : Math.ceil((units * systems.STEPS_PER_UNIT) / points);
};

const swingSeconds: FactReader = (base) => clipSeconds(base, systems.BUILD_HOUSE_ATOMIC_ID, JOB_BUILDER);

const homeSeconds = (base: KnowledgeBase, pct: number, tool: string | null): FactValue => {
  const swings = homeSwings(base, pct, tool);
  const swing = swingSeconds(base);
  return swings === undefined || swing === undefined ? undefined : swings * swing;
};

const MASTER_PCT = PERCENT;

const liftClipTicks = (base: KnowledgeBase): FactValue =>
  clipOf(base, systems.PICKUP_ATOMIC_ID, JOB_CIVILIST)?.length;

/** One unit's lift into or out of `vehicle`, by the sim's own share of the lifting clip. */
const cartLiftSeconds = (base: KnowledgeBase, vehicle: string): FactValue => {
  const clip = liftClipTicks(base);
  const type = base.content.vehicles.find((row) => row.id === vehicle);
  return clip === undefined || type === undefined
    ? undefined
    : seconds(systems.cartLiftTicks(base.content, type, clip));
};

/** A cart's speed loss at `fillPct` of its hold, by the sim's own rule. */
const cartLossAt = (fullLossPct: number, fillPct: number): number =>
  systems.loadSpeedLossPercent(fullLossPct, fillPct, PERCENT);

export const CART_LOAD_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
  CART_FILL_SAMPLES_PCT.flatMap((fill) => {
    const handcart = cartLossAt(systems.HANDCART_FULL_SPEED_LOSS_PERCENT, fill);
    const oxcart = cartLossAt(systems.DRAWN_CART_FULL_SPEED_LOSS_PERCENT, fill);
    return [
      [`vehicle.fill.${fill}`, whole(fill)],
      [`vehicle.handcartLoss.${fill}`, whole(handcart)],
      [`vehicle.oxcartLoss.${fill}`, whole(oxcart)],
      [`pace.handcartLand.${fill}`, fixedOneDecimal(vehiclePace(DEFAULT_NODE_ROUGHNESS, false, handcart))],
      [`pace.oxcartLand.${fill}`, fixedOneDecimal(vehiclePace(DEFAULT_NODE_ROUGHNESS, false, oxcart))],
    ];
  }),
);

/** How far a goods search reaches on `ground`: its budget spent at the ground's cost per point. */
function goodsReach(base: KnowledgeBase, ground: string): FactValue {
  const roughness = groundRoughness(base, ground);
  return roughness === undefined ? undefined : Math.floor(systems.GOODS_SEARCH_SPAN.budget / roughness);
}

export const WALK_FACTS: Readonly<Record<string, Fact>> = {
  'reach.walk': whole(WALK_RANGE_NODES),
  'reach.carrier': whole(CARRIER_WALK_RANGE_NODES),
  'reach.link': whole(SIGNPOST_LINK_RANGE_NODES),
  'reach.linkRoute': whole(components.SIGNPOST_LINK_STEPS),
  'reach.goods': whole(components.GOODS_SEARCH_RANGE_NODES),
  'reach.goodsSand': whole((base) => goodsReach(base, 'sand')),
  'reach.goodsMountain': whole((base) => goodsReach(base, 'mountain')),
  'reach.goodsSnow': whole((base) => goodsReach(base, 'snow')),
  'reach.spacing': whole(components.SIGNPOST_SPACING_NODES),
  'reach.displace': whole(components.SIGNPOST_DISPLACE_RADIUS_NODES),
  'reach.bushAtHand': whole(systems.BUSH_AT_HAND_NODES),
  'reach.spill': whole(systems.SPILL_MAX_RADIUS),
  'step.road': fixedTwoDecimals(stepAt(ROAD_RESISTANCE) ?? 0),
  'step.land': fixedTwoDecimals(stepAt(DEFAULT_NODE_ROUGHNESS) ?? 0),
  'step.landBrief': twoDecimals(stepAt(DEFAULT_NODE_ROUGHNESS) ?? 0),
  'pace.walkerLand': oneDecimal(1 / (stepAt(DEFAULT_NODE_ROUGHNESS) ?? Number.POSITIVE_INFINITY)),
  'step.sand': fixedTwoDecimals((base) => stepAt(groundRoughness(base, 'sand'))),
  'step.mountain': fixedTwoDecimals((base) => stepAt(groundRoughness(base, 'mountain'))),
  'step.snow': fixedTwoDecimals((base) => stepAt(groundRoughness(base, 'snow'))),
  'step.roadBare': fixedTwoDecimals(stepAt(ROAD_RESISTANCE, { shoes: false }) ?? 0),
  'step.landBare': fixedTwoDecimals(stepAt(DEFAULT_NODE_ROUGHNESS, { shoes: false }) ?? 0),
  'step.sandBare': fixedTwoDecimals((base) => stepAt(groundRoughness(base, 'sand'), { shoes: false })),
  'step.mountainBare': fixedTwoDecimals((base) =>
    stepAt(groundRoughness(base, 'mountain'), { shoes: false }),
  ),
  'step.snowBare': fixedTwoDecimals((base) => stepAt(groundRoughness(base, 'snow'), { shoes: false })),
  'step.roadSavedOnLandPct': whole((base) => roadSaving(base, 'land')),
  'step.roadSavedOnSandPct': whole((base) => roadSaving(base, 'sand')),
  'step.roadSavedOnMountainPct': whole((base) => roadSaving(base, 'mountain')),
  'step.roadSavedOnSnowPct': whole((base) => roadSaving(base, 'snow')),
  'step.carryExtra': twoDecimals(stepExtra({ carrying: true })),
  'step.tiredExtra': twoDecimals(stepExtra({ tired: true })),
  'step.childExtra': twoDecimals(stepExtra({ age: 'child' })),
  'step.weightLowExtra': twoDecimals(stepExtra({ equipmentWeight: LOW_STEP_WEIGHT })),
  'step.weightHighExtra': twoDecimals(stepExtra({ equipmentWeight: HIGH_STEP_WEIGHT })),
  'step.weightLowFrom': whole(LOW_STEP_WEIGHT),
  'step.weightLowTo': whole(rowTop(LOW_STEP_WEIGHT)),
  'step.weightHighFrom': whole(HIGH_STEP_WEIGHT),
  'step.weightHighTo': whole(rowTop(HIGH_STEP_WEIGHT)),
  'step.amuletSaved': twoDecimals((base) => {
    const saved = equipOf(base, 'amulet_speed')?.walkStepTicksSaved;
    return saved === undefined ? undefined : seconds(saved);
  }),
  'step.shortest': twoDecimals(seconds(systems.MIN_STEP_TICKS)),
  'step.carrierOnRoad': twoDecimals(stepAt(ROAD_RESISTANCE, { carrying: true }) ?? 0),
  'step.plateSoldierOnLand': twoDecimals((base) => {
    const sword = weaponRow(base, VIKING, 'long_sword')?.weight;
    const armor = base.armor.find((row) => row.goodType === goodTypeOf(base, 'armor_plate'))?.weight;
    if (sword === undefined || armor === undefined) return undefined;
    return stepAt(DEFAULT_NODE_ROUGHNESS, { equipmentWeight: sword + armor });
  }),
  'step.traderFullCart': twoDecimals(
    stepAt(DEFAULT_NODE_ROUGHNESS, { cartSpeedLossPercent: systems.HANDCART_FULL_SPEED_LOSS_PERCENT }) ?? 0,
  ),
  'weight.shortSword': whole((base) => weaponRow(base, VIKING, 'short_sword')?.weight),
  'weight.woodenSpear': whole((base) => weaponRow(base, VIKING, 'wooden_spear')?.weight),
  'weight.ironSpear': whole((base) => weaponRow(base, VIKING, 'iron_spear')?.weight),
  'shoes.road': whole((base) => shoeSteps(base, ROAD_RESISTANCE)),
  'shoes.land': whole((base) => shoeSteps(base, DEFAULT_NODE_ROUGHNESS)),
  'shoes.sand': whole((base) => shoeSteps(base, groundRoughness(base, 'sand'))),
  'shoes.mountain': whole((base) => shoeSteps(base, groundRoughness(base, 'mountain'))),
  'shoes.snow': whole((base) => shoeSteps(base, groundRoughness(base, 'snow'))),
  'shoes.carryWear': whole(systems.CARRYING_WEAR_FACTOR),
  'shoes.roadWear': whole(DEFAULT_NODE_ROUGHNESS / ROAD_RESISTANCE),
};

export const WORK_FACTS: Readonly<Record<string, Fact>> = {
  'build.homeUnits': whole(homeBillPoints),
  'build.bareGainPct': whole(bareSwingGainPct),
  'build.swingSeconds': twoDecimals(swingSeconds),
  'build.noviceSwings': whole((base) => homeSwings(base, 0, null)),
  'build.noviceIronSwings': whole((base) => homeSwings(base, 0, 'tool_iron')),
  'build.masterIronSwings': whole((base) => homeSwings(base, MASTER_PCT, 'tool_iron')),
  'build.noviceSeconds': oneDecimal((base) => homeSeconds(base, 0, null)),
  'build.noviceIronSeconds': oneDecimal((base) => homeSeconds(base, 0, 'tool_iron')),
  'build.masterIronSeconds': oneDecimal((base) => homeSeconds(base, MASTER_PCT, 'tool_iron')),
  'repair.minPerSwing': whole((base) => {
    const points = buildPoints(base, 0, null);
    return points === undefined ? undefined : points * systems.HITPOINTS_PER_REPAIR_STEP;
  }),
  'repair.maxPerSwing': whole((base) => {
    const points = buildPoints(base, MASTER_PCT, 'tool_iron');
    return points === undefined ? undefined : points * systems.HITPOINTS_PER_REPAIR_STEP;
  }),
  'repair.crew': whole(systems.REPAIR_CREW_LIMIT),
  'repair.calmSeconds': whole(seconds(systems.REPAIR_CALM_TICKS)),
  'workshop.counterMax': whole(PRODUCTION_COUNT_MAX),
  'gather.treeYield': whole(WOOD_YIELD_PER_NODE),
  'gather.strokes': whole((base) => trackOf(base, 'collector_wood')?.baseRepeatCounter),
  'gather.wheatStrokes': whole(WHEAT_WORK_REPEATS),
  'gather.herbStrokes': whole((base) => trackOf(base, 'herb_herb')?.baseRepeatCounter),
  'gather.casts': whole((base) => trackOf(base, 'fisher_general')?.baseRepeatCounter),
  'gather.oreNeed': whole((base) => goodNeed(base, 'iron')),
  'gather.treeSeconds': whole((base) =>
    harvestSeconds(base, 'wood', JOB_COLLECTOR, trackOf(base, 'collector_wood')?.baseRepeatCounter),
  ),
  'gather.stoneSeconds': whole((base) =>
    harvestSeconds(base, 'stone', JOB_COLLECTOR, trackOf(base, 'collector_stone')?.baseRepeatCounter),
  ),
  'gather.oreSeconds': whole((base) =>
    harvestSeconds(base, 'iron', JOB_COLLECTOR, trackOf(base, 'collector_iron')?.baseRepeatCounter),
  ),
  'gather.mushroomSeconds': whole((base) => harvestSeconds(base, 'mushroom', JOB_COLLECTOR, 1)),
  'gather.wheatSeconds': whole((base) => harvestSeconds(base, 'wheat', JOB_FARMER, WHEAT_WORK_REPEATS)),
  'gather.herbSeconds': whole((base) =>
    harvestSeconds(base, 'herb', JOB_HERBALIST, trackOf(base, 'herb_herb')?.baseRepeatCounter),
  ),
  'gather.fishSeconds': whole(fishSeconds),
  'field.waterings': whole(FIELD_GROWTH_STAGES - 1),
  'field.max': whole(FARM_MAX_FIELDS),
  'field.radius': whole(FARM_FIELD_RADIUS),
  'field.diagonal': whole(diagonal(FARM_FIELD_RADIUS)),
  'field.reclaimSeconds': whole(seconds(systems.STRANDED_FIELD_RECLAIM_TICKS)),
  'well.stock': whole((base) => stockOf(base, 'work_well_00', 'water')),
  'hive.stock': whole((base) => stockOf(base, 'work_hive_00', 'honey')),
  'bush.regrowSeconds': whole(seconds(systems.BERRY_REGROW_TICKS)),
  'bush.stageSeconds': whole(seconds(systems.BERRY_STAGE_TICKS)),
  'fish.regrowSeconds': whole(seconds(systems.FISH_REPRODUCTION_TICKS)),
  'fish.swarmMax': whole(systems.MAX_FISH_PER_SWARM),
  'tool.uses': whole((base) => equipOf(base, 'tool_iron')?.uses),
  'tool.ironTrees': whole(ironToolTrees),
  'haul.carry': whole(components.CARRY_CAPACITY),
  'haul.crockeryDelivery': whole(components.CARRY_CAPACITY + systems.CROCKERY_BONUS_UNITS),
  'haul.groundStack': whole(systems.MAX_GROUND_STACK),
  'haul.minimumMax': whole(components.STORAGE_MINIMUM_MAX),
  'haul.handcart': whole((base) => vehicleOf(base, 'handcart')?.stockSlots),
  'haul.oxcart': whole((base) => vehicleOf(base, 'oxcart')?.stockSlots),
  'haul.cartTopUp': whole(systems.CART_TOP_UP_REACH),
  'flag.radius': whole(components.DEFAULT_WORK_FLAG_RADIUS),
  'flag.diagonal': whole(diagonal(components.DEFAULT_WORK_FLAG_RADIUS)),
  'flag.hunter': whole(components.HUNTER_WORK_FLAG_RADIUS),
  'flag.fisher': whole(systems.FISH_SHORE_SEARCH_RADIUS),
  'flag.fisherDiagonal': whole(diagonal(systems.FISH_SHORE_SEARCH_RADIUS)),
  'flag.snap': whole(systems.WORK_FLAG_SNAP_MAX_RADIUS),
  'trade.stops': whole(TRADE_ROUTE_HOUSES),
  'trade.handsSeconds': oneDecimal((base) => {
    const clip = liftClipTicks(base);
    return clip === undefined ? undefined : seconds(clip);
  }),
  'trade.handcartSeconds': fixedOneDecimal((base) => cartLiftSeconds(base, 'handcart')),
  'trade.oxcartSeconds': fixedOneDecimal((base) => cartLiftSeconds(base, 'oxcart')),
  'trade.cartParLand': whole((base) => cartParRoute(base, DEFAULT_NODE_ROUGHNESS)),
  'trade.cartParRoad': whole((base) => cartParRoute(base, ROAD_RESISTANCE)),
  'trade.refillLevel': whole(systems.AI_STOCK_REFILL_LEVEL),
  'trade.refillSeconds': whole(seconds(systems.AI_STOCK_REFILL_TURNS * systems.AI_HANDLER_ROUND_TICKS)),
  ...trackFacts('wood', 'collector_wood'),
  ...trackFacts('hunt', 'hunter_general'),
  ...trackFacts('fish', 'fisher_general'),
  ...trackFacts('craft', 'collector_stone'),
  ...trackFacts('build', 'builder_general'),
  'exp.quotedPct': whole(QUOTED_EXPERIENCE_PCT),
  'exp.savedStrokePct': whole(systems.EXPERIENCE_PCT_PER_SAVED_STROKE),
  'star.step': whole(STAR_TIER_STEP),
  'star.full': whole(STAR_FULL),
  'exp.carrierTrader': whole((base) => jobNeed(base, 'trader')),
  'exp.furnitureNeed': whole((base) => goodNeed(base, 'furniture')),
  'school.seats': whole((base) => buildingOf(base, 'school')?.schoolSize),
  'barracks.seats': whole((base) => buildingOf(base, 'barracks')?.schoolSize),
  'barracks.drillSeconds': oneDecimal((base) => drillSeconds(base, systems.BARRACKS_DRILL_TICKS)),
  'barracks.gearStock': whole((base) => stockOf(base, 'barracks', 'sword_long')),
  'barracks.foodStock': whole((base) => stockOf(base, 'barracks', 'food_simple')),
  'barracks.coinStock': whole((base) => stockOf(base, 'barracks', 'coin')),
  'course.shortSeconds': oneDecimal((base) => courseSeconds(base, 'armor_leather')),
  'course.commonSeconds': oneDecimal((base) => courseSeconds(base, 'bow_long')),
  'course.healSeconds': oneDecimal((base) => courseSeconds(base, 'potion_heal_big')),
  'course.handcartSeconds': oneDecimal((base) => courseSeconds(base, 'handcart')),
  'course.oxcartSeconds': oneDecimal((base) => courseSeconds(base, 'oxcart')),
  'course.shipSeconds': oneDecimal((base) => courseSeconds(base, 'ship_small')),
};
