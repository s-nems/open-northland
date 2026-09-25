import type { JobEnables, JobRequirement } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import {
  ATTACK_ATOMIC,
  BUILD_GUIDE_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  CULTIVATE_ATOMIC,
  EAT_ATOMIC,
  EXERCISE_ATOMIC,
  HARVEST_CADAVER_ATOMIC,
  HIVE_DRAW_ATOMIC,
  KISS_ATOMIC,
  KISSED_ATOMIC,
  LISTEN_ATOMIC,
  PLANT_ATOMIC,
  PRAY_ATOMIC,
  SLEEP_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  TALK_ATOMIC,
  WELL_DRAW_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import { PRODUCE_ATOMIC_BY_GOOD_ID, SLAY_ATOMIC_BY_GOOD_ID } from '../../../../catalog/goods.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BREEDER,
  JOB_BUILDER,
  JOB_CIVILIST,
  JOB_HUNTER,
  JOB_JOINER,
  JOB_SCOUT,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../../../../catalog/jobs.js';
import { HUMAN_HITPOINTS } from '../../../../catalog/units.js';
import { PRIMARY_TRIBE } from '../../../rules.js';
import { GATHERERS, JOB_FARMER_SLOT, rebaseSlotJob } from '../../ids/index.js';
import {
  CIVILIST_EAT_ANIMATION,
  CIVILIST_PRAY_ANIMATION,
  CIVILIST_SLEEP_ANIMATION,
  SOLDIER_EAT_ANIMATION,
  SOLDIER_SLEEP_ANIMATION,
  WOMAN_EAT_ANIMATION,
  WOMAN_SLEEP_ANIMATION,
} from '../../need-animations.js';
import {
  BREEDER_PRODUCE_ANIMATION_BY_SPECIES,
  BREEDER_SLAY_ANIMATION_BY_SPECIES,
  BUILD_GUIDE_ANIMATION,
  BUILD_HOUSE_ANIMATION,
  CIVILIST_EXERCISE_ANIMATION,
  CIVILIST_IDLE_SHORT_ANIMATIONS,
  CIVILIST_LISTEN_ANIMATION,
  CIVILIST_TALK_ANIMATION,
  FARMER_REAP_ANIMATION,
  FARMER_SOW_ANIMATION,
  FARMER_WATER_ANIMATION,
  HIVE_DRAW_ANIMATION,
  STORE_PICKUP_ANIMATION,
  STORE_PILEUP_ANIMATION,
  WELL_DRAW_ANIMATION,
  WOMAN_LISTEN_ANIMATION,
  WOMAN_TALK_ANIMATION,
} from '../../work-animations.js';
import type { SandboxContentExtras } from '../types.js';
import { SANDBOX_ANIMAL_TRIBES } from './animals.js';
import { SANDBOX_JOB_ENABLES } from './tech-graph.js';

/** `logicdefines.inc` MAKE_LOVE. The sim pins the same decoded define, so neither can drift alone. */
const MAKE_LOVE_ATOMIC = 78;

export interface SandboxTribe {
  readonly typeId: number;
  readonly id: string;
  readonly hitpoints?: number;
  readonly jobEnables?: readonly JobEnables[];
  readonly jobRequirements?: readonly JobRequirement[];
  readonly atomicBindings?: unknown[];
}

/**
 * Extracted `needforjob 31 5 69` and `trainforjob 31 5 77` on the base soldier class. The armed classes
 * carry no rows on purpose: the weapon-class flip never consults these gates.
 */
const SOLDIER_GATE: readonly JobRequirement[] = [
  {
    requirement: 'need',
    target: 'job',
    targetId: JOB_SOLDIER_UNARMED,
    amount: 5,
    experienceTypes: [systems.SOLDIER_GENERAL_EXPERIENCE_TYPE],
  },
  {
    requirement: 'train',
    target: 'job',
    targetId: JOB_SOLDIER_UNARMED,
    amount: 5,
    experienceTypes: [systems.TRAINING_EXPERIENCE_TYPE],
  },
];

export function buildSandboxTribes(
  jobTypes: readonly number[],
  extras: SandboxContentExtras,
): Map<number, SandboxTribe> {
  const tribes = new Map<number, SandboxTribe>();
  tribes.set(PRIMARY_TRIBE, {
    typeId: PRIMARY_TRIBE,
    id: 'viking',
    hitpoints: HUMAN_HITPOINTS,
    atomicBindings: [
      ...GATHERERS.map((gatherer) => ({
        jobType: gatherer.job,
        atomicId: gatherer.atomic,
        animation: gatherer.animation,
      })),
      // The breeder's species actions, the original's `setatomic 16 85..88` rows: the sim reads which
      // species a slaughter belongs to off the clip name.
      ...Object.keys(SLAY_ATOMIC_BY_GOOD_ID).flatMap((species) =>
        [
          {
            atomicId: PRODUCE_ATOMIC_BY_GOOD_ID[species],
            animation: BREEDER_PRODUCE_ANIMATION_BY_SPECIES[species],
          },
          {
            atomicId: SLAY_ATOMIC_BY_GOOD_ID[species],
            animation: BREEDER_SLAY_ANIMATION_BY_SPECIES[species],
          },
        ].flatMap(({ atomicId, animation }) =>
          atomicId === undefined || animation === undefined
            ? []
            : [{ jobType: rebaseSlotJob(JOB_BREEDER), atomicId, animation }],
        ),
      ),
      // Bound for the woman and civilist jobs, as the original's `setatomic 5/6` rows do.
      { jobType: JOB_WOMAN, atomicId: KISS_ATOMIC, animation: 'viking_woman_kiss' },
      { jobType: JOB_WOMAN, atomicId: KISSED_ATOMIC, animation: 'viking_woman_kissed' },
      { jobType: JOB_WOMAN, atomicId: MAKE_LOVE_ATOMIC, animation: 'viking_woman_make_love' },
      { jobType: JOB_CIVILIST, atomicId: KISS_ATOMIC, animation: 'viking_civilist_kiss' },
      { jobType: JOB_CIVILIST, atomicId: KISSED_ATOMIC, animation: 'viking_civilist_kissed' },
      { jobType: JOB_CIVILIST, atomicId: MAKE_LOVE_ATOMIC, animation: 'viking_civilist_make_love' },
      // The stroke rest slots; every gathering trade resolves them through the sim's civilist fallback.
      ...systems.STROKE_REST_ATOMIC_IDS.flatMap((atomicId, slot) => {
        const animation = CIVILIST_IDLE_SHORT_ANIMATIONS[slot];
        return animation === undefined ? [] : [{ jobType: JOB_CIVILIST, atomicId, animation }];
      }),
      // Every other trade resolves talk and listen through the sim's civilist fallback, the original's
      // `baseatomics 6` inheritance.
      { jobType: JOB_WOMAN, atomicId: TALK_ATOMIC, animation: WOMAN_TALK_ANIMATION },
      { jobType: JOB_WOMAN, atomicId: LISTEN_ATOMIC, animation: WOMAN_LISTEN_ANIMATION },
      { jobType: JOB_CIVILIST, atomicId: TALK_ATOMIC, animation: CIVILIST_TALK_ANIMATION },
      { jobType: JOB_CIVILIST, atomicId: LISTEN_ATOMIC, animation: CIVILIST_LISTEN_ANIMATION },
      // The need slots, the original's `setatomic 5/6/31 8/10/12` rows. Every working trade resolves its
      // meal and its rest through the sim's civilist fallback, the original's `baseatomics 6` inheritance.
      { jobType: JOB_WOMAN, atomicId: EAT_ATOMIC, animation: WOMAN_EAT_ANIMATION },
      { jobType: JOB_WOMAN, atomicId: SLEEP_ATOMIC, animation: WOMAN_SLEEP_ANIMATION },
      { jobType: JOB_CIVILIST, atomicId: EAT_ATOMIC, animation: CIVILIST_EAT_ANIMATION },
      { jobType: JOB_CIVILIST, atomicId: SLEEP_ATOMIC, animation: CIVILIST_SLEEP_ANIMATION },
      { jobType: JOB_CIVILIST, atomicId: PRAY_ATOMIC, animation: CIVILIST_PRAY_ANIMATION },
      { jobType: JOB_SOLDIER_UNARMED, atomicId: EAT_ATOMIC, animation: SOLDIER_EAT_ANIMATION },
      { jobType: JOB_SOLDIER_UNARMED, atomicId: SLEEP_ATOMIC, animation: SOLDIER_SLEEP_ANIMATION },
      // The original's `setatomic 6 89` row; any other trade sent to train falls back to the civilist.
      { jobType: JOB_CIVILIST, atomicId: EXERCISE_ATOMIC, animation: CIVILIST_EXERCISE_ANIMATION },
      // The well and hive shelf actions (`setatomic 6 44/45`); every trade lifting there falls back to
      // the civilist.
      { jobType: JOB_CIVILIST, atomicId: WELL_DRAW_ATOMIC, animation: WELL_DRAW_ANIMATION },
      { jobType: JOB_CIVILIST, atomicId: HIVE_DRAW_ATOMIC, animation: HIVE_DRAW_ANIMATION },
      { jobType: JOB_SOLDIER_UNARMED, atomicId: ATTACK_ATOMIC, animation: 'viking_fist_attack' },
      { jobType: JOB_BUILDER, atomicId: BUILD_HOUSE_ATOMIC, animation: BUILD_HOUSE_ANIMATION },
      { jobType: JOB_SCOUT, atomicId: BUILD_GUIDE_ATOMIC, animation: BUILD_GUIDE_ANIMATION },
      { jobType: JOB_FARMER_SLOT, atomicId: WHEAT_HARVEST_ATOMIC, animation: FARMER_REAP_ANIMATION },
      { jobType: JOB_FARMER_SLOT, atomicId: PLANT_ATOMIC, animation: FARMER_SOW_ANIMATION },
      { jobType: JOB_FARMER_SLOT, atomicId: CULTIVATE_ATOMIC, animation: FARMER_WATER_ANIMATION },
      { jobType: JOB_SOLDIER_SPEAR, atomicId: ATTACK_ATOMIC, animation: 'viking_spear_attack' },
      { jobType: JOB_SOLDIER_SWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_sword_attack' },
      { jobType: JOB_SOLDIER_BROADSWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_broadsword_attack' },
      { jobType: JOB_ARCHER, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_attack' },
      { jobType: JOB_ARCHER_LONG, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_long_attack' },
      { jobType: JOB_HUNTER, atomicId: ATTACK_ATOMIC, animation: 'viking_hunter_attack' },
      {
        jobType: JOB_HUNTER,
        atomicId: HARVEST_CADAVER_ATOMIC,
        animation: 'viking_hunter_harvest_cadaver',
      },
      ...jobTypes.flatMap((jobType) => [
        { jobType, atomicId: STORE_PICKUP_ATOMIC, animation: STORE_PICKUP_ANIMATION },
        { jobType, atomicId: STORE_PILEUP_ATOMIC, animation: STORE_PILEUP_ANIMATION },
      ]),
    ],
    jobEnables: SANDBOX_JOB_ENABLES,
    jobRequirements: [
      ...SOLDIER_GATE,
      // Owned CnMod tribetypes.ini: trainforjob 9 10 77.
      {
        requirement: 'train',
        target: 'job',
        targetId: JOB_JOINER,
        amount: 10,
        experienceTypes: [systems.TRAINING_EXPERIENCE_TYPE],
      },
    ],
  });
  // No hitpoints row: an animal's HP pool comes from its animal record, not the tribe table.
  for (const tribe of SANDBOX_ANIMAL_TRIBES) {
    tribes.set(tribe.typeId, { typeId: tribe.typeId, id: tribe.id });
  }
  for (const tribe of extras.tribes ?? []) {
    if (!tribes.has(tribe.typeId)) {
      // No tech graph: an empty edge list gates nothing, so an extra tribe's buildings stay enabled
      // without an enabler settler.
      tribes.set(tribe.typeId, { typeId: tribe.typeId, id: tribe.id, hitpoints: HUMAN_HITPOINTS });
    }
  }
  return tribes;
}
