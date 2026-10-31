import { ContentSet, IR_VERSION } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { ATTACK_ATOMIC } from '../../src/catalog/atomics.js';

export const VIKING = 1;
export const FRANK = 2;
export const WOLF_TRIBE = 20;
/** A species the data defines and no body look draws. */
const BODILESS_TRIBE = 24;
export const HARE_TRIBE = 16;
export const CIVILIST_JOB = 6;
export const SMITH_JOB = 13;
export const CARRIER_JOB = 24;
export const COLLECTOR_JOB = 8;
export const SOLDIER_SPEAR_JOB = 32;
export const SABER_JOB = 36;

export const GOOD = {
  water: 1,
  wheat: 4,
  wood: 5,
  iron: 6,
  flour: 11,
  leather: 9,
  food_simple: 16,
  food_extra: 17,
  fruit: 18,
  bread: 19,
  candy: 20,
  meat: 21,
  fish: 22,
  sausage: 23,
  spear_wooden: 39,
  armor_leather: 34,
  amulet_food: 50,
  prey: 56,
  sheep: 57,
  cattle: 58,
  handcart: 59,
  chest: 64,
  anything: 65,
} as const;

export const HOUSE = {
  well: 10,
  mill: 13,
  bakery: 14,
  smithy: 31,
  druid: 35,
  yard: 42,
  school: 38,
  murek: 55,
} as const;

const MILL_FLOUR = { goodType: GOOD.flour, amount: 1 };
const EAT_CLIP = 'viking_civilist_eat_slot_food';
const CANDY_CLIP = 'viking_civilist_eat_slot_candy';
const SPEAR_CLIP = 'viking_spear_attack';
export const SPEAR_CLIP_TICKS = 24;
const HUNGER = systems.ATOMIC_EVENT_CHANNEL.HUNGER;
const LEISURE = systems.ATOMIC_EVENT_CHANNEL.LEISURE;
const PLAIN_MEAL_UNITS = 4000;
const CANDY_MEAL_UNITS = 6000;
const CANDY_LEISURE_UNITS = 4000;
export const FRANK_SMITHY_HITPOINTS = 900;
export const SMITHY_HITPOINTS = 700;

const event = (type: number, value?: number) => ({ at: 1, type, value, extended: false });

/** A small hand-built content set holding one of each row shape the reference reads. */
export function knowledgeContent(): ContentSet {
  return ContentSet.parse({
    manifest: { version: IR_VERSION, generatedFrom: { data: 'test' }, locale: 'eng' },
    goods: [...Object.entries(GOOD).map(([id, typeId]) => ({ typeId, id }))].map((g) => {
      if (g.id === 'leather') return { ...g, productionInputs: [{ goodType: GOOD.cattle, amount: 1 }] };
      if (g.id === 'handcart') return { ...g, vehicleHouse: HOUSE.yard };
      return g;
    }),
    jobs: [
      { typeId: 5, id: 'woman' },
      { typeId: CIVILIST_JOB, id: 'civilist' },
      { typeId: COLLECTOR_JOB, id: 'collector' },
      { typeId: SMITH_JOB, id: 'smith' },
      { typeId: CARRIER_JOB, id: 'carrier' },
      { typeId: SOLDIER_SPEAR_JOB, id: 'soldier_spear_wooden' },
      { typeId: SABER_JOB, id: 'soldier_saber_short' },
      { typeId: 49, id: 'adult_animal' },
    ],
    buildings: [
      {
        typeId: HOUSE.well,
        id: 'work_well_00',
        kind: 'workplace',
        produces: [GOOD.water],
        stock: [{ goodType: GOOD.water, capacity: 9 }],
      },
      {
        typeId: HOUSE.mill,
        id: 'work_mill_00',
        kind: 'workplace',
        produces: [GOOD.flour],
        recipes: [{ inputs: [{ goodType: GOOD.wheat, amount: 2 }], outputs: [MILL_FLOUR] }],
        workers: [
          { jobType: CARRIER_JOB, count: 1 },
          { jobType: COLLECTOR_JOB, count: 2 },
        ],
      },
      {
        typeId: HOUSE.bakery,
        id: 'work_bakery_00',
        kind: 'workplace',
        recipes: [
          {
            inputs: [{ goodType: GOOD.flour, amount: 3 }],
            outputs: [{ goodType: GOOD.bread, amount: 1 }],
          },
          {
            inputs: [
              { goodType: GOOD.food_simple, amount: 1 },
              { goodType: GOOD.iron, amount: 1 },
            ],
            outputs: [{ goodType: GOOD.amulet_food, amount: 1 }],
          },
        ],
        construction: [{ goodType: GOOD.wood, amount: 4 }],
      },
      {
        typeId: HOUSE.smithy,
        id: 'work_smithy_00',
        kind: 'workplace',
        hitpoints: SMITHY_HITPOINTS,
        tribeVariants: [{ tribe: FRANK, hitpoints: FRANK_SMITHY_HITPOINTS }],
        workers: [
          { jobType: CARRIER_JOB, count: 1 },
          { jobType: SMITH_JOB, count: 2 },
        ],
      },
      { typeId: HOUSE.druid, id: 'work_druid_00', kind: 'workplace' },
      {
        typeId: HOUSE.yard,
        id: 'handcart',
        kind: 'vehicle',
        construction: [{ goodType: GOOD.wood, amount: 7 }],
      },
      { typeId: HOUSE.murek, id: 'work_murek', kind: 'workplace' },
    ],
    weapons: [
      {
        typeId: 20,
        id: 'house_bow',
        tribeType: VIKING,
        jobType: SOLDIER_SPEAR_JOB,
        mainType: 1,
        damage: { '0': 100 },
      },
      {
        typeId: 4,
        id: 'wooden_spear',
        tribeType: VIKING,
        jobType: SOLDIER_SPEAR_JOB,
        goodType: GOOD.spear_wooden,
        mainType: 2,
        damage: { '0': 100 },
      },
      {
        typeId: 10,
        id: 'short_saber',
        tribeType: VIKING,
        jobType: SABER_JOB,
        goodType: GOOD.spear_wooden,
        mainType: 4,
      },
      { typeId: 1, id: 'bite', tribeType: WOLF_TRIBE, damage: { '0': 30 }, minRange: 1, maxRange: 2 },
    ],
    armor: [
      { typeId: 2, id: 'leather_armor', goodType: GOOD.armor_leather, materialType: 2, blockingValue: 5 },
    ],
    animals: [
      { id: 'animal_20', tribeType: WOLF_TRIBE, hitpointsAdult: 1000, aggressive: true },
      { id: 'animal_16', tribeType: HARE_TRIBE, hitpointsAdult: 300, aggressive: true, warrantable: true },
      { id: 'animal_27', tribeType: 27 },
      { id: 'animal_24', tribeType: BODILESS_TRIBE, hitpointsAdult: 1000 },
    ],
    vehicles: [
      { typeId: 1, id: 'handcart', jobId: 50, stockSlots: 15, hitpoints: 800, commanderJob: CARRIER_JOB },
      { typeId: 6, id: 'cart_no_ox', jobId: 55, hitpoints: 800 },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          { jobType: CIVILIST_JOB, atomicId: systems.EAT_ATOMIC_ID, animation: EAT_CLIP },
          { jobType: CIVILIST_JOB, atomicId: systems.EAT_CANDY_ATOMIC_ID, animation: CANDY_CLIP },
          { jobType: SOLDIER_SPEAR_JOB, atomicId: ATTACK_ATOMIC, animation: SPEAR_CLIP },
        ],
        jobEnables: [
          { jobType: COLLECTOR_JOB, kind: 'good', targetId: GOOD.wood },
          { jobType: SMITH_JOB, kind: 'house', targetId: HOUSE.druid },
          { jobType: SMITH_JOB, kind: 'vehicle', targetId: 1 },
        ],
        jobRequirements: [
          { requirement: 'need', target: 'job', targetId: SMITH_JOB, amount: 10, experienceTypes: [6] },
          { requirement: 'train', target: 'job', targetId: SMITH_JOB, amount: 10, experienceTypes: [77] },
          {
            requirement: 'train',
            target: 'job',
            targetId: SOLDIER_SPEAR_JOB,
            amount: 10,
            experienceTypes: [77],
          },
          { requirement: 'need', target: 'good', targetId: GOOD.iron, amount: 5, experienceTypes: [6] },
        ],
        permissions: {
          job: [5, CIVILIST_JOB, COLLECTOR_JOB, SMITH_JOB, CARRIER_JOB, SOLDIER_SPEAR_JOB],
          house: [],
          good: [],
        },
        technology: {
          houses: [{ house: HOUSE.druid, jobs: [SMITH_JOB], goods: [GOOD.food_simple] }],
        },
      },
      {
        typeId: FRANK,
        id: 'frank',
        jobEnables: [{ jobType: CIVILIST_JOB, kind: 'job', targetId: SMITH_JOB }],
        walkStepReduction: { ticks: 2 },
      },
      { typeId: WOLF_TRIBE, id: 'wolves' },
    ],
    jobExperience: [{ typeId: 6, id: 'collector_iron', jobType: COLLECTOR_JOB }],
    atomicAnimations: [
      { id: EAT_CLIP, name: EAT_CLIP, length: 10, events: [event(HUNGER, PLAIN_MEAL_UNITS)] },
      {
        id: CANDY_CLIP,
        name: CANDY_CLIP,
        length: 10,
        events: [event(HUNGER, CANDY_MEAL_UNITS), event(LEISURE, CANDY_LEISURE_UNITS)],
      },
      {
        id: SPEAR_CLIP,
        name: SPEAR_CLIP,
        length: SPEAR_CLIP_TICKS,
        events: [event(systems.ATOMIC_EVENT_TYPE_ATTACK), event(systems.ATOMIC_EVENT_TYPE_ATTACK)],
      },
    ],
  });
}
