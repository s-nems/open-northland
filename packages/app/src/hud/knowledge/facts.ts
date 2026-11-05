import type { GoodQuantity } from '@open-northland/data';
import {
  CARRIER_WALK_RANGE_NODES,
  components,
  DEFAULT_NODE_ROUGHNESS,
  hexDistanceBetween,
  ONE,
  PRODUCTION_COUNT_MAX,
  ROAD_RESISTANCE,
  SIGNPOST_LINK_RANGE_NODES,
  systems,
  TICKS_PER_MINUTE,
  TICKS_PER_SECOND,
  TRADE_ROUTE_HOUSES,
  WALK_RANGE_NODES,
} from '@open-northland/sim';
import { VIKING } from '../../catalog/buildings.js';
import {
  FARM_FIELD_RADIUS,
  FARM_MAX_FIELDS,
  FIELD_GROWTH_STAGES,
  WHEAT_WORK_REPEATS,
} from '../../catalog/farming.js';
import { WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import {
  JOB_ARMORER,
  JOB_BUILDER,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_FARMER,
  JOB_FISHER,
  JOB_HERBALIST,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../../catalog/jobs.js';
import { BYZANTINE_SPEAR_VARIANTS } from '../../catalog/unit-variants.js';
import {
  CLOSED_GATE_LOGIC_ID,
  POST_STRENGTH,
  playerWallRow,
  scaledWallRules,
  WALL_LOGIC_ID,
} from '../../content/map/palisade-rows.js';
import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import { FRANK } from '../../scenes/civilizations.js';
import { STAR_FULL, STAR_TIER_STEP } from '../../view/projections/experience-stars.js';
import { SETTLEMENT_REACH_NODES } from '../tool-panel/messages/fight-areas.js';
import {
  IDLE_SWEEPS_BEFORE_MESSAGE,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
} from '../tool-panel/messages/from-snapshot.js';
import { STORAGE_FULL_GRACE_TICKS } from '../tool-panel/messages/storage-full.js';
import { PRODUCTION_STALL_GRACE_TICKS } from '../tool-panel/messages/workshop-stalls.js';
import { buildingHitpoints } from './base.js';
import {
  ANIMAL_TARGET,
  CAP_HITS,
  type CombatTarget,
  CRITICAL_CHANCE_PCT,
  combatTargets,
  HIT_DIRECTION,
  HUMAN_HITPOINTS,
  hitsToKill,
  landed,
  STRENGTH_PCT,
  type TargetId,
  takesStrengthAmulet,
} from './combat.js';
import type { KnowledgeBase } from './model.js';

const PERCENT = 100;
const MAX_FRACTION_DIGITS = 2;
const SECONDS_PER_MINUTE = TICKS_PER_MINUTE / TICKS_PER_SECOND;
/** A Manhattan radius along the lattice's diagonal: each diagonal step there spends one and a half points. */
const DIAGONAL_STEP_COST = 1.5;
/** The experience percent the articles quote as the first useful level of a track. */
const QUOTED_EXPERIENCE_PCT = 51;
/** The hits the articles' sample rows stand on. */
const FIGHT_SAMPLE_HITS = [10, 25, 50, 75] as const;
const AIM_SAMPLE_HITS = 50;
const STONE_SAMPLE_HITS = [0, 25, 50] as const;
/** The experience percents a builder's swing gains a point at, the rows of the construction table. */
const BUILD_SAMPLES_PCT = [0, 10, 22, 50, 79, 90] as const;
/** A cart's unit is lifted twice: into the cart and out of it. */
const LIFTS_PER_UNIT = 2;
/** The hold fills, in percent, the cart load table shows a row of. */
const CART_FILL_SAMPLES_PCT = [0, 25, 50, 75, 100] as const;
/** The value the fight-experience table shows a blow of. */
const SAMPLE_BLOW = 1000;
const PER_MILLE = 1000;
/** The combined weights the walking table's two rows open at: every second point costs a tick. */
const LOW_STEP_WEIGHT = 2;
const HIGH_STEP_WEIGHT = 4;
/** The walk the needs article states a barefoot Energy cost over: a step alone costs a hundredth of a percent. */
const BAREFOOT_SAMPLE_STEPS = 1000;

type FactValue = number | undefined;
type FactReader = (base: KnowledgeBase) => FactValue;

/** A number an article may name, and how many decimals the language writes it with. */
interface Fact {
  readonly read: FactReader;
  readonly minFraction: number;
  readonly maxFraction: number;
  /** A length of time in seconds, written as minutes and seconds once it reaches a minute. */
  readonly duration?: boolean;
}

const formatted =
  (minFraction: number, maxFraction: number) =>
  (value: FactReader | number): Fact => ({
    read: typeof value === 'number' ? () => value : value,
    minFraction,
    maxFraction,
  });

const whole = formatted(0, 0);
const oneDecimal = formatted(0, 1);
const twoDecimals = formatted(0, 2);
const fixedOneDecimal = formatted(1, 1);
const fixedTwoDecimals = formatted(2, 2);
const duration = (value: FactReader | number): Fact => ({ ...whole(value), duration: true });

const seconds = (ticks: number): number => ticks / TICKS_PER_SECOND;
const minutes = (ticks: number): number => ticks / TICKS_PER_MINUTE;
const needPct = (units: number): number => (units * PERCENT) / systems.NEED_RESERVE_UNITS;
const diagonal = (radius: number): number => radius / DIAGONAL_STEP_COST;
/** The whole minutes and the seconds left over of a duration, rounded to the second. */
const minutePart = (secondsTotal: number): number =>
  Math.floor(Math.round(secondsTotal) / SECONDS_PER_MINUTE);
const secondPart = (secondsTotal: number): number => Math.round(secondsTotal) % SECONDS_PER_MINUTE;

const equipOf = (base: KnowledgeBase, good: string) => base.goodById.get(good)?.equip ?? undefined;
const homeWare = (base: KnowledgeBase, good: string) => base.goodById.get(good)?.homeQuality ?? undefined;
const buildingOf = (base: KnowledgeBase, id: string) => base.buildingById.get(id);

function goodTypeOf(base: KnowledgeBase, good: string): number | undefined {
  return base.content.goods.find((row) => row.id === good)?.typeId;
}

function stockOf(base: KnowledgeBase, building: string, good: string): FactValue {
  const goodType = goodTypeOf(base, good);
  return buildingOf(base, building)?.stock.find((slot) => slot.goodType === goodType)?.capacity;
}

const amountOf = (
  base: KnowledgeBase,
  rows: readonly GoodQuantity[] | undefined,
  good: string,
): FactValue => {
  const goodType = goodTypeOf(base, good);
  return rows?.find((row) => row.goodType === goodType)?.amount;
};

const vehicleOf = (base: KnowledgeBase, id: string) => base.vehicles.find((row) => row.id === id);
const trackOf = (base: KnowledgeBase, id: string) => base.content.jobExperience.find((row) => row.id === id);
const groundRoughness = (base: KnowledgeBase, ground: string): FactValue =>
  base.content.trianglePatternTypes.find((row) => row.debugName === ground)?.moveResistance;

/** The clip `tribe` plays for `atomicId` in `jobType`. */
function clipOf(base: KnowledgeBase, atomicId: number, jobType: number, tribe: number = VIKING) {
  const name = base.content.tribes
    .find((row) => row.typeId === tribe)
    ?.atomicBindings.find((row) => row.jobType === jobType && row.atomicId === atomicId)?.animation;
  return base.content.atomicAnimations.find((row) => row.name === name);
}

const clipSeconds = (base: KnowledgeBase, atomicId: number, jobType: number, tribe?: number): FactValue => {
  const length = clipOf(base, atomicId, jobType, tribe)?.length;
  return length === undefined ? undefined : seconds(length);
};

/** What a clip's events move a need bar by, in percent. */
function clipNeedPct(base: KnowledgeBase, atomicId: number, jobType: number, channel: number): FactValue {
  const name = clipOf(base, atomicId, jobType)?.name;
  return name === undefined
    ? undefined
    : needPct(systems.atomicEventChannelDelta(base.content, name, channel));
}

const produceAtomic = (base: KnowledgeBase, good: string): FactValue =>
  base.content.goods.find((row) => row.id === good)?.atomics.produce;

/** The Religion one run of `good` costs its maker, in percent. */
function pietyCost(base: KnowledgeBase, good: string, jobType: number): FactValue {
  const atomic = produceAtomic(base, good);
  if (atomic === undefined) return undefined;
  const delta = clipNeedPct(base, atomic, jobType, systems.ATOMIC_EVENT_CHANNEL.PIETY);
  return delta === undefined ? undefined : -delta;
}

const sleepPct = (base: KnowledgeBase, jobType: number): FactValue =>
  clipNeedPct(base, systems.SLEEP_ATOMIC_ID, jobType, systems.ATOMIC_EVENT_CHANNEL.REST);

const scaled =
  (read: FactReader, factor: number) =>
  (base: KnowledgeBase): FactValue => {
    const value = read(base);
    return value === undefined ? undefined : value * factor;
  };

/** `read` times `pct` percent, rounded down as a blow's percent is. */
const scaledDown =
  (read: FactReader, pct: number) =>
  (base: KnowledgeBase): FactValue => {
    const value = read(base);
    return value === undefined ? undefined : Math.floor((value * pct) / PERCENT);
  };

const manSleepPct: FactReader = (base) => sleepPct(base, JOB_CIVILIST);
const womanSleepPct: FactReader = (base) => sleepPct(base, JOB_WOMAN);

/** One sleep's use of the furniture: a use per rest event the clip plays. */
function furnitureSleeps(base: KnowledgeBase, jobType: number): FactValue {
  const ware = homeWare(base, 'furniture');
  const restEvents = clipOf(base, systems.SLEEP_ATOMIC_ID, jobType)?.events.filter(
    (event) => event.type === systems.ATOMIC_EVENT_CHANNEL.REST,
  ).length;
  if (ware === undefined || restEvents === undefined || restEvents === 0) return undefined;
  return ware.deliveryValue / ware.useCost / restEvents;
}

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

const weaponRow = (base: KnowledgeBase, tribe: number, id: string) =>
  base.weapons.get(tribe)?.find((row) => row.id === id);

function targetOf(base: KnowledgeBase, id: TargetId): CombatTarget | undefined {
  return combatTargets(base).find((target) => target.id === id);
}

function hitOf(base: KnowledgeBase, tribe: number, id: string, targetId: TargetId): FactValue {
  const weapon = weaponRow(base, tribe, id);
  const target = targetOf(base, targetId);
  return weapon === undefined || target === undefined ? undefined : landed(weapon, target);
}

const clipOfWeapon = (base: KnowledgeBase, tribe: number, id: string): FactValue => {
  const ticks = weaponRow(base, tribe, id)?.clipTicks;
  return ticks === undefined || ticks === null ? undefined : seconds(ticks);
};

/** A ranged weapon's standoff, the band's far edge a chaser closes to. */
function standoffOf(base: KnowledgeBase, tribe: number, id: string): FactValue {
  const weapon = weaponRow(base, tribe, id);
  return weapon === undefined ? undefined : systems.rangedStandoff(weapon.minRange, weapon.maxRange);
}

const WEAPON_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
  (
    [
      ['hunterBow', 'hunter_bow'],
      ['catapult', 'catapult'],
      ['shortBow', 'short_bow'],
      ['longBow', 'long_bow'],
      ['heroBow', 'hero_bow'],
    ] as const
  ).flatMap(([name, id]) => [
    [`${name}.min`, whole((base) => weaponRow(base, VIKING, id)?.minRange)],
    [`${name}.max`, whole((base) => weaponRow(base, VIKING, id)?.maxRange)],
  ]),
);

const towerMax = (id: string): Fact =>
  whole((base) => {
    const max = weaponRow(base, VIKING, id)?.maxRange;
    return max === undefined ? undefined : max + systems.TOWER_RANGE_BONUS_NODES;
  });

const standoff = (id: string): Fact => whole((base) => standoffOf(base, VIKING, id));

const hit = (tribe: number, id: string, target: TargetId): Fact =>
  whole((base) => hitOf(base, tribe, id, target));

const killedBy = (damage: FactReader, hitpoints: FactReader) =>
  whole((base) => {
    const blow = damage(base);
    const pool = hitpoints(base);
    return blow === undefined || pool === undefined ? undefined : (hitsToKill(blow, pool) ?? undefined);
  });

const catapultHp: FactReader = (base) => vehicleOf(base, 'catapult')?.hitpoints;
const catapultStone =
  (target: TargetId): FactReader =>
  (base) =>
    hitOf(base, VIKING, 'catapult', target);

function stoneSeconds(base: KnowledgeBase, hitpoints: FactValue): FactValue {
  const blow = catapultStone('building')(base);
  const clip = clipOfWeapon(base, VIKING, 'catapult');
  if (blow === undefined || clip === undefined || hitpoints === undefined) return undefined;
  const hits = hitsToKill(blow, hitpoints);
  return hits === null ? undefined : hits * clip;
}

const buildingHp = (base: KnowledgeBase, id: string, tribe: number = VIKING): FactValue => {
  const row = buildingOf(base, id);
  return row === undefined ? undefined : (buildingHitpoints(row, tribe) ?? undefined);
};

/** A course's length: the drill plays whole clips until its time is spent. */
function drillSeconds(base: KnowledgeBase, ticks: number): FactValue {
  const clip = clipOf(base, systems.EXERCISE_ATOMIC_ID, JOB_CIVILIST)?.length;
  return clip === undefined ? undefined : seconds(Math.ceil(ticks / clip) * clip);
}

/** A school course of `lessons`, in seconds. */
export function lessonSeconds(base: KnowledgeBase, lessons: number): FactValue {
  return drillSeconds(base, lessons * systems.SCHOOL_LESSON_TICKS);
}

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

const trackPoints = (base: KnowledgeBase, id: string): FactValue => {
  const factor = trackOf(base, id)?.experienceFactor;
  return factor === undefined ? undefined : factor / systems.EXPERIENCE_XP_PER_POINT;
};

function pointsToPct(pct: number): number {
  let points = 0;
  while (systems.experiencePercent(points) < pct) points++;
  return points;
}

const repeatsTo = (base: KnowledgeBase, id: string, points: number): FactValue => {
  const worth = trackPoints(base, id);
  return worth === undefined ? undefined : Math.ceil(points / worth);
};

const trackFacts = (name: string, id: string): Readonly<Record<string, Fact>> => ({
  [`exp.${name}.repeatsQuoted`]: whole((base) => repeatsTo(base, id, pointsToPct(QUOTED_EXPERIENCE_PCT))),
  [`exp.${name}.repeatsFull`]: whole((base) => repeatsTo(base, id, systems.EXPERIENCE_MASTERY_POINTS)),
});

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
  const handcartLift = liftSeconds(base, systems.HANDCART_LIFT_PERCENT);
  const oxcartLift = liftSeconds(base, systems.DRAWN_CART_LIFT_PERCENT);
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

const BUILD_TABLE_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
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
const TOOL_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
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

const liftSeconds = (base: KnowledgeBase, percent: number): FactValue => {
  const clip = clipOf(base, systems.PICKUP_ATOMIC_ID, JOB_CIVILIST)?.length;
  return clip === undefined ? undefined : seconds(Math.max(1, Math.round((clip * percent) / PERCENT)));
};

/** Points a vehicle crosses per second, `lossPct` of its pace gone under load. */
function vehiclePace(roughness: number, siege: boolean, lossPct: number): number {
  const period = systems.vehicleMovePeriod(roughness, siege);
  return TICKS_PER_SECOND / (period + systems.cartDragTicks(period, lossPct));
}

/** A cart's speed loss at `fillPct` of its hold, by the sim's own rule. */
const cartLossAt = (fullLossPct: number, fillPct: number): number =>
  systems.loadSpeedLossPercent(fullLossPct, fillPct, PERCENT);

const CART_LOAD_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
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

const FIGHT_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
  FIGHT_SAMPLE_HITS.flatMap((hits) => {
    const blow = systems.withFightExperience(SAMPLE_BLOW, hits);
    return [
      [`fight.factor.${hits}`, twoDecimals(blow / SAMPLE_BLOW)],
      [`fight.blow.${hits}`, whole(blow)],
    ];
  }),
);

const chestCount = (good: string, kind: 'magical' | 'wooden'): number | undefined => {
  const reward = [...systems.CHEST_CONTENTS.values()]
    .filter((row) => row.kind === 'goods' && row.good === good)
    .at(-1);
  return reward?.kind === 'goods' ? reward.count[kind] : undefined;
};

const chestAnimals = (tribe: string): number | undefined => {
  const reward = [...systems.CHEST_CONTENTS.values()].find(
    (row) => row.kind === 'animals' && row.tribe === tribe,
  );
  return reward?.kind === 'animals' ? reward.count : undefined;
};

const chestSettlers: FactReader = () => {
  const reward = [...systems.CHEST_CONTENTS.values()].find((row) => row.kind === 'settlers');
  return reward?.kind === 'settlers' ? reward.count : undefined;
};

const pctFactor = (pct: FactValue): FactValue => (pct === undefined ? undefined : pct / PERCENT);

const healSip: FactReader = (base) => {
  const pct = equipOf(base, 'potion_heal_small')?.restorePct?.healthMax;
  return pct === undefined ? undefined : (HUMAN_HITPOINTS * pct) / PERCENT;
};

const regenTicks = HUMAN_HITPOINTS / systems.REGENERATION_HITPOINTS_PER_TICK;
const starveTicks = HUMAN_HITPOINTS / systems.STARVATION_HITPOINTS_PER_TICK;
const auraSeconds = HUMAN_HITPOINTS / systems.TEMPLE_AURA_HITPOINTS;

/** A home ware's `field` in delivered units. */
function wareRatio(base: KnowledgeBase, good: string, field: 'capacity' | 'fetchBelow'): FactValue {
  const ware = homeWare(base, good);
  return ware === undefined ? undefined : ware[field] / ware.deliveryValue;
}

/** One delivered unit of oil's burn, a use a second. */
function oilBurnSeconds(base: KnowledgeBase): FactValue {
  const ware = homeWare(base, 'holy_oil');
  return ware === undefined ? undefined : ware.deliveryValue / ware.useCost;
}

/** How far a goods search reaches on `ground`: its budget spent at the ground's cost per point. */
function goodsReach(base: KnowledgeBase, ground: string): FactValue {
  const roughness = groundRoughness(base, ground);
  return roughness === undefined ? undefined : Math.floor(components.SIGNPOST_LINK_STEPS / roughness);
}

const shotsPerSeat = TICKS_PER_SECOND / systems.SHELTER_SHOT_PERIOD_TICKS;

const shelterShots = (base: KnowledgeBase, id: string): FactValue => {
  const seats = buildingOf(base, id)?.shelterCapacity;
  return seats === undefined ? undefined : seats * shotsPerSeat;
};

const NEED_FACTS: Readonly<Record<string, Fact>> = {
  'need.drivePct': whole(needPct(systems.NEED_DRIVE_UNITS)),
  'need.criticalPct': whole(needPct(systems.NEED_CRITICAL_UNITS)),
  'need.satedPct': whole(needPct(systems.NEED_SATED_UNITS)),
  'need.overfillPct': whole(needPct(systems.NEED_RESERVE_UNITS + systems.NEED_OVERFILL_UNITS)),
  'need.startMinPct': whole(needPct(systems.NEED_RESERVE_UNITS - systems.NEED_INIT_SPREAD_UNITS)),
  'need.drainMinutes': whole(minutes(ONE / systems.DRAIN_RISE)),
  'need.barefootSampleSteps': whole(BAREFOOT_SAMPLE_STEPS),
  'need.barefootRoadPct': whole(needPct(ROAD_RESISTANCE * BAREFOOT_SAMPLE_STEPS)),
  'need.barefootLandPct': whole(needPct(DEFAULT_NODE_ROUGHNESS * BAREFOOT_SAMPLE_STEPS)),
  'need.barefootMaxPct': whole(needPct(systems.ROUGHNESS_MAX_ON_MAPS * BAREFOOT_SAMPLE_STEPS)),
  'sleep.manSeconds': oneDecimal((base) => clipSeconds(base, systems.SLEEP_ATOMIC_ID, JOB_CIVILIST)),
  'sleep.womanSeconds': oneDecimal((base) => clipSeconds(base, systems.SLEEP_ATOMIC_ID, JOB_WOMAN)),
  'sleep.soldierSeconds': oneDecimal((base) =>
    clipSeconds(base, systems.SLEEP_ATOMIC_ID, JOB_SOLDIER_UNARMED),
  ),
  'sleep.manAwayPct': whole(scaled(manSleepPct, 1 / systems.AWAY_REST_DIVISOR)),
  'sleep.manHomePct': whole(manSleepPct),
  'sleep.manFurnishedPct': whole(scaled(manSleepPct, systems.AT_HOME_FACTOR)),
  'sleep.womanAwayPct': whole(scaled(womanSleepPct, 1 / systems.AWAY_REST_DIVISOR)),
  'sleep.womanHomePct': whole(womanSleepPct),
  'sleep.womanFurnishedPct': whole(scaled(womanSleepPct, systems.AT_HOME_FACTOR)),
  'sleep.soldierPct': whole((base) => sleepPct(base, JOB_SOLDIER_UNARMED)),
  'pray.seconds': oneDecimal((base) => clipSeconds(base, systems.PRAY_ATOMIC_ID, JOB_CIVILIST)),
  'pray.pct': whole((base) =>
    clipNeedPct(base, systems.PRAY_ATOMIC_ID, JOB_CIVILIST, systems.ATOMIC_EVENT_CHANNEL.PIETY),
  ),
  'talk.shortSeconds': oneDecimal((base) => clipSeconds(base, components.TALK_ATOMIC_ID, JOB_WOMAN)),
  'talk.longSeconds': oneDecimal((base) => clipSeconds(base, components.TALK_ATOMIC_ID, JOB_CIVILIST)),
  'talk.pct': whole((base) =>
    clipNeedPct(base, components.TALK_ATOMIC_ID, JOB_CIVILIST, systems.ATOMIC_EVENT_CHANNEL.LEISURE),
  ),
  'meal.seconds': oneDecimal((base) => clipSeconds(base, systems.EAT_ATOMIC_ID, JOB_CIVILIST)),
  'meal.plainPct': whole((base) => base.goodById.get('bread')?.meal?.hungerPct),
  'meal.plainHomePct': whole((base) => base.goodById.get('bread')?.meal?.homeHungerPct),
  'meal.candyPct': whole((base) => base.goodById.get('candy')?.meal?.hungerPct),
  'meal.candyHomePct': whole((base) => base.goodById.get('candy')?.meal?.homeHungerPct),
  'meal.candyCompanyPct': whole((base) => base.goodById.get('candy')?.meal?.leisurePct),
  'alert.standTo': whole(systems.STAND_TO_RADIUS_NODES),
  'alert.restClearance': whole(systems.REST_CLEARANCE_NODES),
};

const HEALTH_FACTS: Readonly<Record<string, Fact>> = {
  'health.human': whole(HUMAN_HITPOINTS),
  'health.regenPerSecond': whole(systems.REGENERATION_HITPOINTS_PER_TICK * TICKS_PER_SECOND),
  'health.regenMinutes': whole(minutes(regenTicks)),
  'health.regenTime': duration(seconds(regenTicks)),
  'health.starvePerSecond': whole(systems.STARVATION_HITPOINTS_PER_TICK * TICKS_PER_SECOND),
  'health.starveTime': duration(seconds(starveTicks)),
  'health.nearDeath': whole((HUMAN_HITPOINTS * systems.NEAR_DEATH_PER_MILLE) / PER_MILLE),
  'aura.range': whole(systems.TEMPLE_AURA_RANGE),
  'aura.perSecond': whole(systems.TEMPLE_AURA_HITPOINTS),
  'aura.time': duration(auraSeconds),
  'aura.ceiling': whole(systems.blessedHitpointCeiling(HUMAN_HITPOINTS)),
  'aura.totalPerSecond': whole(
    systems.REGENERATION_HITPOINTS_PER_TICK * TICKS_PER_SECOND + systems.TEMPLE_AURA_HITPOINTS,
  ),
  'aura.pietyPct': oneDecimal(needPct(systems.TEMPLE_AURA_PIETY_UNITS)),
  'draught.healBelow': whole((HUMAN_HITPOINTS * systems.HEALING_DRAUGHT_BELOW_PCT) / PERCENT),
  'draught.healSmallTotal': whole((base) =>
    scaled(healSip, equipOf(base, 'potion_heal_small')?.uses ?? 0)(base),
  ),
  'draught.healBigTotal': whole((base) => scaled(healSip, equipOf(base, 'potion_heal_big')?.uses ?? 0)(base)),
  'draught.smallUses': whole((base) => equipOf(base, 'potion_heal_small')?.uses),
  'draught.bigUses': whole((base) => equipOf(base, 'potion_heal_big')?.uses),
  'draught.meadUses': whole((base) => equipOf(base, 'mead')?.uses),
  'draught.meadPct': whole((base) => equipOf(base, 'mead')?.restorePct?.hunger),
  'draught.potionPct': whole((base) => equipOf(base, 'potion_food_small')?.restorePct?.hunger),
  'amulet.needPct': whole((base) => equipOf(base, 'amulet_food')?.restorePct?.hunger),
  'amulet.strengthFactor': oneDecimal(STRENGTH_PCT / PERCENT),
  'amulet.critChancePct': whole(CRITICAL_CHANCE_PCT),
  'amulet.critFactor': oneDecimal((base) =>
    pctFactor(equipOf(base, 'amulet_crithit')?.criticalHit?.damagePct),
  ),
  'amulet.comboFactor': oneDecimal((base) => {
    const critical = pctFactor(equipOf(base, 'amulet_crithit')?.criticalHit?.damagePct);
    return critical === undefined ? undefined : (critical * STRENGTH_PCT) / PERCENT;
  }),
  'amulet.defenseFactor': oneDecimal((base) => pctFactor(equipOf(base, 'amulet_defense')?.damageTakenPct)),
  'amulet.slots': whole(components.MISC_EQUIP_SLOTS),
};

const LIFE_FACTS: Readonly<Record<string, Fact>> = {
  'age.yearSeconds': whole(seconds(systems.TICKS_PER_AGE_YEAR)),
  'age.childYears': whole(systems.CHILD_AGE_TICKS / systems.TICKS_PER_AGE_YEAR),
  'age.babyLastYear': whole(systems.CHILD_AGE_TICKS / systems.TICKS_PER_AGE_YEAR - 1),
  'age.adultYears': whole(systems.ADULT_AGE_TICKS / systems.TICKS_PER_AGE_YEAR),
  'age.childLastYear': whole(systems.ADULT_AGE_TICKS / systems.TICKS_PER_AGE_YEAR - 1),
  'age.childTime': duration(seconds(systems.CHILD_AGE_TICKS)),
  'age.adultTime': duration(seconds(systems.ADULT_AGE_TICKS)),
  'family.childFood': whole(components.CHILD_FOOD_UNITS),
  'home.larder': whole((base) => stockOf(base, 'home_level_00', 'food_simple')),
  'home.candyLarder': whole((base) => stockOf(base, 'home_level_00', 'food_extra')),
  'home.wareUnits': whole((base) => wareRatio(base, 'crockery', 'capacity')),
  'home.crockeryDeliveries': whole((base) => {
    const ware = homeWare(base, 'crockery');
    return ware === undefined ? undefined : ware.deliveryValue / ware.useCost;
  }),
  'home.furnitureManSleeps': whole((base) => furnitureSleeps(base, JOB_CIVILIST)),
  'home.furnitureWomanSleeps': whole((base) => furnitureSleeps(base, JOB_WOMAN)),
  'home.crockeryFetchBelow': whole((base) => wareRatio(base, 'crockery', 'fetchBelow')),
  'home.furnitureFetchBelow': whole((base) => wareRatio(base, 'furniture', 'fetchBelow')),
  'home.oilFetchBelow': whole((base) => wareRatio(base, 'holy_oil', 'fetchBelow')),
  'oil.burnTime': duration(oilBurnSeconds),
  'oil.fullBurnTime': duration((base) => {
    const burn = oilBurnSeconds(base);
    const units = wareRatio(base, 'holy_oil', 'capacity');
    return burn === undefined || units === undefined ? undefined : burn * units;
  }),
  'assistant.counterMax': whole(components.ASSISTANT_COUNTER_MAX),
  'assistant.flagMin': whole(systems.FOLLOW_FLAG_BAND.min),
  'assistant.flagMax': whole(systems.FOLLOW_FLAG_BAND.max),
};

const WALK_FACTS: Readonly<Record<string, Fact>> = {
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

const WORK_FACTS: Readonly<Record<string, Fact>> = {
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
  'trade.handsSeconds': oneDecimal((base) => liftSeconds(base, PERCENT)),
  'trade.handcartSeconds': fixedOneDecimal((base) => liftSeconds(base, systems.HANDCART_LIFT_PERCENT)),
  'trade.oxcartSeconds': fixedOneDecimal((base) => liftSeconds(base, systems.DRAWN_CART_LIFT_PERCENT)),
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

/** The farthest a stray shot of `hits` strikes from its mark over `range` nodes: the highest roll's spread
 *  on both axes at once, in hexes. */
function strayReach(range: number, hits: number): number {
  const side = systems.widestScatterOffset(systems.widestMarksmanSpread(range, hits));
  return hexDistanceBetween(0, 0, side, side);
}

const longestBowShot = (base: KnowledgeBase): FactValue => {
  const max = weaponRow(base, VIKING, 'long_bow')?.maxRange;
  return max === undefined ? undefined : max + systems.TOWER_RANGE_BONUS_NODES;
};

const strayFact = (range: FactReader, hits: number): Fact =>
  whole((base) => {
    const reach = range(base);
    return reach === undefined ? undefined : strayReach(reach, hits);
  });

const weaponMax =
  (id: string): FactReader =>
  (base) =>
    weaponRow(base, VIKING, id)?.maxRange;

/** The fewest bow hits past which no shot strays, whatever a bow's range. */
const steadyHits: FactReader = (base) => {
  const range = longestBowShot(base);
  if (range === undefined) return undefined;
  let hits = 0;
  while (strayReach(range, hits) > 0) hits++;
  return hits;
};

const AIM_FACTS: Readonly<Record<string, Fact>> = {
  'aim.spreadShort': strayFact(weaponMax('short_bow'), 0),
  'aim.spreadLong': strayFact(weaponMax('long_bow'), 0),
  'aim.spreadTower': strayFact(longestBowShot, 0),
  'aim.noSpreadHits': whole(steadyHits),
  ...Object.fromEntries(
    STONE_SAMPLE_HITS.map((hits) => [`stone.spread.${hits}`, strayFact(weaponMax('catapult'), hits)]),
  ),
};

const wallRules = (base: KnowledgeBase, id: string, scale: number) => {
  const row = base.content.landscape.find((type) => type.id === id);
  const wall = row === undefined ? undefined : playerWallRow(row);
  return wall === undefined ? undefined : scaledWallRules(wall, scale);
};

const segmentRules = (base: KnowledgeBase) => wallRules(base, WALL_LOGIC_ID, POST_STRENGTH);
const gateRules = (base: KnowledgeBase) =>
  wallRules(base, CLOSED_GATE_LOGIC_ID, systems.GATE_SPAN_OFFSETS.length);

/** What one blow of a weapon takes off a wall, by the name the walls' table reads it under. */
const WALL_WEAPONS = [
  ['catapult', VIKING, 'catapult'],
  ['hero', VIKING, 'hero_sword'],
  ['ironSpear', VIKING, 'iron_spear'],
  ['longSword', VIKING, 'long_sword'],
  ['shortSword', VIKING, 'short_sword'],
  ['woodenSpear', VIKING, 'wooden_spear'],
  ['shortBow', VIKING, 'short_bow'],
  ['longBow', VIKING, 'long_bow'],
] as const;

const wallBlow = (base: KnowledgeBase, tribe: number, id: string): FactValue => {
  const blow = hitOf(base, tribe, id, 'building');
  return blow === undefined ? undefined : Math.floor(blow / systems.HOUSE_DAMAGE_PER_WALL_VALENCY);
};

/** A blow under the Amulet of Strength; a shot no amulet raises keeps its plain blow. */
const strongWallBlow = (tribe: number, id: string): Fact => {
  const blow: FactReader = (base) => wallBlow(base, tribe, id);
  return whole(takesStrengthAmulet({ id }) ? scaledDown(blow, STRENGTH_PCT) : blow);
};

const WALL_FACTS: Readonly<Record<string, Fact>> = {
  'wall.segmentHp': whole((base) => segmentRules(base)?.maxHitpoints),
  'wall.gateHp': whole((base) => gateRules(base)?.maxHitpoints),
  'wall.segmentRepair': whole((base) => segmentRules(base)?.repairPerStrike),
  'wall.gateRepair': whole((base) => gateRules(base)?.repairPerStrike),
  'wall.gateSegments': whole(systems.GATE_SPAN_OFFSETS.length),
  'wall.gateMinHealthPct': whole(systems.GATE_MIN_HEALTH_PCT),
  'wall.heroBow.blow': whole((base) => wallBlow(base, VIKING, 'hero_bow')),
  'wall.frankHeroBow.blow': whole((base) => wallBlow(base, FRANK, 'hero_bow')),
  ...Object.fromEntries(
    WALL_WEAPONS.flatMap(([name, tribe, id]) => {
      const blow: FactReader = (base) => wallBlow(base, tribe, id);
      const pool =
        (rules: typeof segmentRules): FactReader =>
        (base) =>
          rules(base)?.maxHitpoints;
      return [
        [`wall.${name}.blow`, whole(blow)],
        // A Catapult cannot take an Amulet of Strength, so its stones have no strong blow.
        ...(name === 'catapult' ? [] : [[`wall.${name}.strongBlow`, strongWallBlow(tribe, id)] as const]),
        [`wall.${name}.segmentHits`, killedBy(blow, pool(segmentRules))],
        [`wall.${name}.gateHits`, killedBy(blow, pool(gateRules))],
        [
          `wall.${name}.segmentSeconds`,
          duration((base) => {
            const blows = blow(base);
            const hitpoints = pool(segmentRules)(base);
            const clip = clipOfWeapon(base, tribe, id);
            if (blows === undefined || hitpoints === undefined || clip === undefined) return undefined;
            const hits = hitsToKill(blows, hitpoints);
            return hits === null ? undefined : hits * clip;
          }),
        ],
      ];
    }),
  ),
};

const COMBAT_FACTS: Readonly<Record<string, Fact>> = {
  'shortBow.towerMax': towerMax('short_bow'),
  'longBow.towerMax': towerMax('long_bow'),
  'shortBow.standoff': standoff('short_bow'),
  'longBow.standoff': standoff('long_bow'),
  'heroBow.standoff': standoff('hero_bow'),
  'combat.fightCapHits': whole(CAP_HITS),
  'combat.fightCapFactor': whole(systems.withFightExperience(SAMPLE_BLOW, CAP_HITS) / SAMPLE_BLOW),
  'combat.fightCapBlow': whole(systems.withFightExperience(SAMPLE_BLOW, CAP_HITS)),
  'combat.sampleBlow': whole(SAMPLE_BLOW),
  'combat.backSideFactor': twoDecimals(HIT_DIRECTION.backSide / PERCENT),
  'combat.behindFactor': twoDecimals(HIT_DIRECTION.behind / PERCENT),
  'aim.basePct': whole(systems.trueShotPct(0)),
  'aim.samplePct': whole(systems.trueShotPct(AIM_SAMPLE_HITS)),
  'stance.search': whole(systems.DEFEND_RADIUS_NODES),
  'stance.defendLeash': whole(systems.DEFEND_LEASH_NODES),
  'stance.ignoreLeash': whole(systems.IGNORE_LEASH_NODES),
  'stance.attackReturn': whole(systems.ATTACK_RETURN_SLACK_NODES),
  'stance.soldierAlarm': whole(systems.ALARM_SOLDIER_RADIUS_NODES),
  'stance.peopleAlarm': whole(systems.ALARM_PEOPLE_RADIUS_NODES),
  'stance.fleeMin': whole(systems.FLEE_STEP_NODES),
  'stance.fleeMax': whole(systems.FLEE_STEP_NODES * DIAGONAL_STEP_COST),
  'contest.radius': whole(systems.CONTESTED_GROUND_RADIUS_NODES),
  'contest.diagonal': whole(diagonal(systems.CONTESTED_GROUND_RADIUS_NODES)),
  'peace.keepOut': whole(systems.PEACE_KEEP_OUT_RADIUS_NODES),
  'peace.noticeFirstMinutes': whole(systems.PEACE_NOTICE_MINUTES[0]),
  'peace.noticeLastMinutes': whole(systems.PEACE_NOTICE_MINUTES[1]),
  'wall.gateEnemyNear': whole(systems.GATE_ENEMY_NEAR_POINTS),
  'wall.damagePerPoint': whole(systems.HOUSE_DAMAGE_PER_WALL_VALENCY),
  'shelter.hq': whole((base) => buildingOf(base, 'headquarters')?.shelterCapacity),
  'shelter.tower2': whole((base) => buildingOf(base, 'tower_01')?.shelterCapacity),
  'shelter.tower1': whole((base) => buildingOf(base, 'tower_00')?.shelterCapacity),
  'shelter.barracks': whole((base) => buildingOf(base, 'barracks')?.shelterCapacity),
  'shelter.shotsPerSeat': oneDecimal(shotsPerSeat),
  'shelter.hqShots': whole((base) => shelterShots(base, 'headquarters')),
  'shelter.tower2Shots': whole((base) => shelterShots(base, 'tower_01')),
  'shelter.tower1Shots': whole((base) => shelterShots(base, 'tower_00')),
  'shelter.barracksShots': whole((base) => shelterShots(base, 'barracks')),
  'shelter.range': whole((base) => weaponRow(base, VIKING, 'house_bow')?.maxRange),
  'arrow.vehicle': hit(VIKING, 'house_bow', 'vehicle'),
  'tower1.mead': whole((base) => stockOf(base, 'tower_00', 'mead')),
  'tower1.food': whole((base) => stockOf(base, 'tower_00', 'food_simple')),
  'tower1.weapon': whole((base) => stockOf(base, 'tower_00', 'bow_short')),
  'tower2.mead': whole((base) => stockOf(base, 'tower_01', 'mead')),
  'tower2.food': whole((base) => stockOf(base, 'tower_01', 'food_simple')),
  'tower2.weapon': whole((base) => stockOf(base, 'tower_01', 'bow_short')),
  'dragon.hitpoints': whole(BYZANTINE_SPEAR_VARIANTS.find((row) => row.form === 'native')?.hitpoints ?? 0),
  'catapult.searchRadius': whole(systems.VEHICLE_SCAN_RADIUS_POINTS),
  'catapult.leash': whole(systems.VEHICLE_DEFENCE_LEASH_POINTS),
  'catapult.bandMin': whole((base) => {
    const max = weaponRow(base, VIKING, 'catapult')?.maxRange;
    return max === undefined ? undefined : max - systems.APPROACH_BAND_DEPTH;
  }),
  'stone.vehicle': whole(catapultStone('vehicle')),
  'stone.vehicleKills': killedBy(catapultStone('vehicle'), catapultHp),
  'stone.tower1': killedBy(catapultStone('building'), (base) => buildingHp(base, 'tower_00')),
  'stone.tower2': killedBy(catapultStone('building'), (base) => buildingHp(base, 'tower_01')),
  'stone.hq': killedBy(catapultStone('building'), (base) => buildingHp(base, 'headquarters')),
  'stone.frankHq': killedBy(catapultStone('building'), (base) => buildingHp(base, 'headquarters', FRANK)),
  'stone.tower1Seconds': duration((base) => stoneSeconds(base, buildingHp(base, 'tower_00'))),
  'stone.tower2Seconds': duration((base) => stoneSeconds(base, buildingHp(base, 'tower_01'))),
  'stone.hqSeconds': duration((base) => stoneSeconds(base, buildingHp(base, 'headquarters'))),
  'stone.frankHqSeconds': duration((base) => stoneSeconds(base, buildingHp(base, 'headquarters', FRANK))),
  'hp.tower1': whole((base) => buildingHp(base, 'tower_00')),
  'hp.tower2': whole((base) => buildingHp(base, 'tower_01')),
  'hp.hq': whole((base) => buildingHp(base, 'headquarters')),
  'hp.frankHq': whole((base) => buildingHp(base, 'headquarters', FRANK)),
  'vs.catapult.spear': hit(VIKING, 'iron_spear', 'vehicle'),
  'vs.catapult.spearHits': killedBy((base) => hitOf(base, VIKING, 'iron_spear', 'vehicle'), catapultHp),
  'vs.catapult.shortSword': hit(VIKING, 'short_sword', 'vehicle'),
  'vs.catapult.shortSwordHits': killedBy((base) => hitOf(base, VIKING, 'short_sword', 'vehicle'), catapultHp),
  'vs.catapult.fist': hit(VIKING, 'fist', 'vehicle'),
  'vs.catapult.fistHits': killedBy((base) => hitOf(base, VIKING, 'fist', 'vehicle'), catapultHp),
  'vs.catapult.arrowHits': killedBy((base) => hitOf(base, VIKING, 'house_bow', 'vehicle'), catapultHp),
};

const WORLD_FACTS: Readonly<Record<string, Fact>> = {
  'pace.cartRoad': fixedOneDecimal(vehiclePace(ROAD_RESISTANCE, false, 0)),
  'pace.handcartRoadFull': fixedOneDecimal(
    vehiclePace(ROAD_RESISTANCE, false, systems.HANDCART_FULL_SPEED_LOSS_PERCENT),
  ),
  'pace.oxcartRoadFull': fixedOneDecimal(
    vehiclePace(ROAD_RESISTANCE, false, systems.DRAWN_CART_FULL_SPEED_LOSS_PERCENT),
  ),
  'pace.catapultRoad': fixedOneDecimal(vehiclePace(ROAD_RESISTANCE, true, 0)),
  'pace.catapultLand': twoDecimals(vehiclePace(DEFAULT_NODE_ROUGHNESS, true, 0)),
  'pace.ship': whole((base) => {
    const ticks = vehicleOf(base, 'ship_small')?.moveTicks;
    return ticks === undefined ? undefined : TICKS_PER_SECOND / ticks;
  }),
  'vehicle.mooringDistance': whole((base) => {
    return base.content.vehicles.find((row) => row.id === 'ship_small')?.passengerVector?.distance;
  }),
  'vehicle.cargoSearch': whole(systems.VEHICLE_CARGO_SEARCH_RADIUS),
  'vehicle.spill': whole(systems.VEHICLE_CARGO_SPILL_RADIUS),
  'livestock.pair': whole(systems.BREEDING_PAIR),
  'livestock.pairPlusOne': whole(systems.BREEDING_PAIR + 1),
  'livestock.captureRange': whole(systems.LIVESTOCK_CAPTURE_RANGE),
  'livestock.scatterRange': whole(systems.SCATTER_RANGE),
  'livestock.growMinutes': whole(minutes(systems.ANIMAL_ADULT_AGE_TICKS)),
  'livestock.farmHerd': whole((base) => stockOf(base, 'work_animal_farm', 'sheep')),
  'livestock.sheepWool': whole((base) => amountOf(base, base.goodById.get('sheep')?.slaughterYield, 'wool')),
  'livestock.sheepMeat': whole((base) => amountOf(base, base.goodById.get('sheep')?.slaughterYield, 'meat')),
  'livestock.cattleLeather': whole((base) =>
    amountOf(base, base.goodById.get('cattle')?.slaughterYield, 'leather'),
  ),
  'livestock.cattleMeat': whole((base) =>
    amountOf(base, base.goodById.get('cattle')?.slaughterYield, 'meat'),
  ),
  'wild.aggro': whole(systems.ANIMAL_AGGRO_RADIUS_NODES),
  'wild.giveUp': whole(systems.ANIMAL_ACQUIRE_RANGE_NODES),
  'wild.angrySeconds': whole((base) => {
    const ticks = base.animals.find((row) => row.getAngry)?.angryTicks;
    return ticks === undefined ? undefined : seconds(ticks);
  }),
  'wild.flight': whole(systems.FLIGHT_REACH_NODES),
  'wild.kinAlarm': whole(systems.KIN_ALARM_RADIUS_NODES),
  'wild.growthMinutes': whole(minutes(systems.BREEDING_SPAN_TICKS * systems.BREEDING_SPANS_PER_ROUND)),
  'wild.breedingShare': whole(systems.LEADER_UPKEEP_PERIOD_TICKS / systems.BREEDING_SPAN_TICKS),
  'wild.huntChase': whole(systems.HUNT_CHASE_SLACK_NODES),
  'wild.hunterShot': whole((base) => {
    const weapon = weaponRow(base, VIKING, 'hunter_bow');
    return weapon === undefined ? undefined : landed(weapon, ANIMAL_TARGET);
  }),
  'vision.scout': whole(systems.SCOUT_VISION_NODES),
  'vision.hero': whole(systems.HERO_VISION_NODES),
  'vision.soldier': whole(systems.SOLDIER_VISION_NODES),
  'vision.cart': whole(systems.CART_VISION_NODES),
  'vision.adult': whole(systems.CIVILIAN_VISION_NODES),
  'vision.child': whole(systems.CHILD_VISION_NODES),
  'explore.maxFailedLegs': whole(systems.EXPLORE_MAX_FAILED_LEGS),
  'chest.singleWooden': whole(chestCount('potion_food_small', 'wooden') ?? 0),
  'chest.singleMagical': whole(chestCount('potion_food_small', 'magical') ?? 0),
  'chest.bulkWooden': whole(chestCount('potion_heal_big', 'wooden') ?? 0),
  'chest.bulkMagical': whole(chestCount('potion_heal_big', 'magical') ?? 0),
  'chest.wearWooden': whole(chestCount('armor_chain', 'wooden') ?? 0),
  'chest.wearMagical': whole(chestCount('armor_chain', 'magical') ?? 0),
  'chest.foodWooden': whole(chestCount('food_simple', 'wooden') ?? 0),
  'chest.foodMagical': whole(chestCount('food_simple', 'magical') ?? 0),
  'chest.settlers': whole(chestSettlers),
  'chest.wolves': whole(chestAnimals('wolves') ?? 0),
  'chest.lions': whole(chestAnimals('lions') ?? 0),
  'notice.settlementReach': whole(SETTLEMENT_REACH_NODES),
  'notice.yardRetrySeconds': whole(seconds(systems.UNREACHABLE_GOAL_MEMO_TICKS)),
  'notice.noGathererSeconds': whole(seconds(PRODUCTION_STALL_GRACE_TICKS)),
  'notice.idleSeconds': whole(seconds(IDLE_SWEEPS_BEFORE_MESSAGE * SNAPSHOT_SWEEP_INTERVAL_TICKS)),
  'match.graceSeconds': whole(seconds(systems.MATCH_DEATH_GRACE_TICKS)),
  'piety.lowPct': whole((base) => pietyCost(base, 'bow_short', JOB_ARMORER)),
  'piety.highPct': whole((base) => pietyCost(base, 'bow_long', JOB_ARMORER)),
  'notice.storageFullSeconds': whole(seconds(STORAGE_FULL_GRACE_TICKS)),
};

/** The numbers an article may name as `{{name}}`, so its text never retypes what the game owns. */
export const FACTS: Readonly<Record<string, Fact>> = {
  ...NEED_FACTS,
  ...HEALTH_FACTS,
  ...LIFE_FACTS,
  ...WALK_FACTS,
  ...WORK_FACTS,
  ...COMBAT_FACTS,
  ...AIM_FACTS,
  ...WALL_FACTS,
  ...WORLD_FACTS,
  ...WEAPON_FACTS,
  ...BUILD_TABLE_FACTS,
  ...TOOL_FACTS,
  ...CART_LOAD_FACTS,
  ...FIGHT_FACTS,
};

/** A number as the reader's language writes it. */
export function formatFactNumber(value: number, maxFraction = MAX_FRACTION_DIGITS, minFraction = 0): string {
  return new Intl.NumberFormat(bcp47Tag(), {
    minimumFractionDigits: minFraction,
    maximumFractionDigits: maxFraction,
    useGrouping: false,
  }).format(value);
}

/** Seconds as the reader's language writes a time: "X s" under a minute, else "X min Y s". */
function durationText(secondsTotal: number): string {
  const copy = messages().knowledge.mechanics;
  const rounded = Math.round(secondsTotal);
  if (rounded < SECONDS_PER_MINUTE)
    return formatMessage(copy.seconds, { seconds: formatFactNumber(rounded) });
  const minutes = formatFactNumber(minutePart(rounded));
  const rest = secondPart(rounded);
  if (rest === 0) return formatMessage(copy.wholeMinutes, { minutes });
  return formatMessage(copy.minutes, { minutes, seconds: formatFactNumber(rest) });
}

export function factText(name: string, base: KnowledgeBase): string | undefined {
  const fact = Object.hasOwn(FACTS, name) ? FACTS[name] : undefined;
  const value = fact?.read(base);
  if (fact === undefined || value === undefined) return undefined;
  return fact.duration === true
    ? durationText(value)
    : formatFactNumber(value, fact.maxFraction, fact.minFraction);
}
