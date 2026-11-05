import {
  components,
  DEFAULT_NODE_ROUGHNESS,
  ONE,
  ROAD_RESISTANCE,
  systems,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { JOB_CIVILIST, JOB_SOLDIER_UNARMED, JOB_WOMAN } from '../../../catalog/jobs.js';
import { CRITICAL_CHANCE_PCT, HUMAN_HITPOINTS, STRENGTH_PCT } from '../combat.js';
import type { KnowledgeBase } from '../model.js';
import {
  clipNeedPct,
  clipOf,
  clipSeconds,
  duration,
  equipOf,
  type Fact,
  type FactReader,
  type FactValue,
  minutes,
  needPct,
  oneDecimal,
  PERCENT,
  seconds,
  stockOf,
  whole,
} from './reader.js';

const PER_MILLE = 1000;

/** The walk the needs article states a barefoot Energy cost over: a step alone costs a hundredth of a percent. */
const BAREFOOT_SAMPLE_STEPS = 1000;

const homeWare = (base: KnowledgeBase, good: string) => base.goodById.get(good)?.homeQuality ?? undefined;

const sleepPct = (base: KnowledgeBase, jobType: number): FactValue =>
  clipNeedPct(base, systems.SLEEP_ATOMIC_ID, jobType, systems.ATOMIC_EVENT_CHANNEL.REST);

const scaled =
  (read: FactReader, factor: number) =>
  (base: KnowledgeBase): FactValue => {
    const value = read(base);
    return value === undefined ? undefined : value * factor;
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

export const NEED_FACTS: Readonly<Record<string, Fact>> = {
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

export const HEALTH_FACTS: Readonly<Record<string, Fact>> = {
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

export const LIFE_FACTS: Readonly<Record<string, Fact>> = {
  'age.yearSeconds': oneDecimal(seconds(systems.TICKS_PER_AGE_YEAR)),
  'age.childYears': oneDecimal(systems.CHILD_AGE_TICKS / systems.TICKS_PER_AGE_YEAR),
  'age.adultYears': oneDecimal(systems.ADULT_AGE_TICKS / systems.TICKS_PER_AGE_YEAR),
  'age.childTime': duration(seconds(systems.CHILD_AGE_TICKS)),
  'age.adultTime': duration(seconds(systems.ADULT_AGE_TICKS)),
  'family.childFood': whole(components.CHILD_FOOD_UNITS),
  'home.factor': whole(systems.AT_HOME_FACTOR),
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
