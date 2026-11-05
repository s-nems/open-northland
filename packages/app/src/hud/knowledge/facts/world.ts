import type { GoodQuantity } from '@open-northland/data';
import { DEFAULT_NODE_ROUGHNESS, ROAD_RESISTANCE, systems, TICKS_PER_SECOND } from '@open-northland/sim';
import { VIKING } from '../../../catalog/buildings.js';
import { JOB_ARMORER } from '../../../catalog/jobs.js';
import { SETTLEMENT_REACH_NODES } from '../../tool-panel/messages/fight-areas.js';
import {
  IDLE_SWEEPS_BEFORE_MESSAGE,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
} from '../../tool-panel/messages/from-snapshot.js';
import { STORAGE_FULL_GRACE_TICKS } from '../../tool-panel/messages/storage-full.js';
import { PRODUCTION_STALL_GRACE_TICKS } from '../../tool-panel/messages/workshop-stalls.js';
import { ANIMAL_TARGET, landed } from '../combat.js';
import type { KnowledgeBase } from '../model.js';
import {
  clipNeedPct,
  type Fact,
  type FactReader,
  type FactValue,
  fixedOneDecimal,
  goodTypeOf,
  minutes,
  seconds,
  stockOf,
  twoDecimals,
  vehicleOf,
  vehiclePace,
  weaponRow,
  whole,
} from './reader.js';

const amountOf = (
  base: KnowledgeBase,
  rows: readonly GoodQuantity[] | undefined,
  good: string,
): FactValue => {
  const goodType = goodTypeOf(base, good);
  return rows?.find((row) => row.goodType === goodType)?.amount;
};

const vehicleSlotsOf = (base: KnowledgeBase, id: string): FactValue =>
  base.content.vehicles.find((row) => row.id === id)?.vehicleSlots;

const produceAtomic = (base: KnowledgeBase, good: string): FactValue =>
  base.content.goods.find((row) => row.id === good)?.atomics.produce;

/** The Religion one run of `good` costs its maker, in percent. */
function pietyCost(base: KnowledgeBase, good: string, jobType: number): FactValue {
  const atomic = produceAtomic(base, good);
  if (atomic === undefined) return undefined;
  const delta = clipNeedPct(base, atomic, jobType, systems.ATOMIC_EVENT_CHANNEL.PIETY);
  return delta === undefined ? undefined : -delta;
}

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

export const WORLD_FACTS: Readonly<Record<string, Fact>> = {
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
  'vehicle.shipSlots': whole((base) => vehicleSlotsOf(base, 'ship_small')),
  'vehicle.bigShipSlots': whole((base) => vehicleSlotsOf(base, 'ship_big')),
  'vehicle.cargoSearch': whole(systems.VEHICLE_CARGO_SEARCH_RADIUS),
  'vehicle.spill': whole(systems.VEHICLE_CARGO_SPILL_RADIUS),
  'livestock.pair': whole(systems.BREEDING_PAIR),
  'draught.kept': whole(systems.DRAUGHT_BREEDING_PAIR),
  'draught.keptPlusOne': whole(systems.DRAUGHT_BREEDING_PAIR + 1),
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
  'vision.headquarters': whole(systems.HEADQUARTERS_VISION_NODES),
  'vision.ship': whole(systems.SHIP_VISION_NODES),
  'vision.building': whole(systems.BUILDING_VISION_NODES),
  'vision.siege': whole(systems.SIEGE_VISION_NODES),
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
