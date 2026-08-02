import type { JobEnables, JobRequirement } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import {
  ATTACK_ATOMIC,
  BUILD_GUIDE_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  CULTIVATE_ATOMIC,
  EXERCISE_ATOMIC,
  HARVEST_CADAVER_ATOMIC,
  KISS_ATOMIC,
  KISSED_ATOMIC,
  LISTEN_ATOMIC,
  PLANT_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  TALK_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BUILDER,
  JOB_CIVILIST,
  JOB_HUNTER,
  JOB_SCOUT,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../../../../catalog/jobs.js';
import { HUMAN_HITPOINTS } from '../../../../catalog/units.js';
import { PRIMARY_TRIBE } from '../../../rules.js';
import { GATHERERS, JOB_FARMER_SLOT } from '../../ids/index.js';
import {
  BUILD_GUIDE_ANIMATION,
  BUILD_HOUSE_ANIMATION,
  CIVILIST_EXERCISE_ANIMATION,
  CIVILIST_LISTEN_ANIMATION,
  CIVILIST_TALK_ANIMATION,
  FARMER_REAP_ANIMATION,
  FARMER_SOW_ANIMATION,
  FARMER_WATER_ANIMATION,
  STORE_PICKUP_ANIMATION,
  STORE_PILEUP_ANIMATION,
  WOMAN_LISTEN_ANIMATION,
  WOMAN_TALK_ANIMATION,
} from '../../work-animations.js';
import type { SandboxContentExtras } from '../types.js';
import { SANDBOX_ANIMAL_TRIBES } from './animals.js';
import { SANDBOX_JOB_ENABLES } from './tech-graph.js';

/** The make-love atomic (`logicdefines.inc` MAKE_LOVE = 78) - the hearts phase's duration key. The
 *  sim transcribes the same id (`systems/family/children/make-love.ts` MAKE_LOVE_ATOMIC_ID); both pin to the
 *  decoded define, so neither can drift alone. */
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
 * The base soldier class's two gate rows, transcribed from the extracted viking table: `needforjob 31 5
 * 69` (five repeats of the `soldier general` track) and `trainforjob 31 5 77` (five TRAINING repeats).
 * How the two combine is the sim's `schoolingMet`. The armed classes' own rows wait on the weapon slice
 * (docs/tickets/features/barracks-recruitment.md).
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

/** Build the primary tribe's atomic bindings plus any caller-declared tribes. */
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
      // The family pair: kiss/kissed (atomics 20/21) time the wedding, make_love (78) times the
      // hearts phase - bound for the woman/civilist jobs like the original's `setatomic 5/6` rows.
      { jobType: JOB_WOMAN, atomicId: KISS_ATOMIC, animation: 'viking_woman_kiss' },
      { jobType: JOB_WOMAN, atomicId: KISSED_ATOMIC, animation: 'viking_woman_kissed' },
      { jobType: JOB_WOMAN, atomicId: MAKE_LOVE_ATOMIC, animation: 'viking_woman_make_love' },
      { jobType: JOB_CIVILIST, atomicId: KISS_ATOMIC, animation: 'viking_civilist_kiss' },
      { jobType: JOB_CIVILIST, atomicId: KISSED_ATOMIC, animation: 'viking_civilist_kissed' },
      { jobType: JOB_CIVILIST, atomicId: MAKE_LOVE_ATOMIC, animation: 'viking_civilist_make_love' },
      // The gossip pair: talk/listen (atomics 14/15) time the chat rounds and carry the channel-3
      // refill pulses - bound for the woman/civilist jobs like the original's `setatomic 5/6 14/15`
      // rows; every other trade resolves them through the sim's civilist fallback (the `baseatomics 6`
      // inheritance, systems/social/gossip/).
      { jobType: JOB_WOMAN, atomicId: TALK_ATOMIC, animation: WOMAN_TALK_ANIMATION },
      { jobType: JOB_WOMAN, atomicId: LISTEN_ATOMIC, animation: WOMAN_LISTEN_ANIMATION },
      { jobType: JOB_CIVILIST, atomicId: TALK_ATOMIC, animation: CIVILIST_TALK_ANIMATION },
      { jobType: JOB_CIVILIST, atomicId: LISTEN_ATOMIC, animation: CIVILIST_LISTEN_ANIMATION },
      // The barracks drill, bound for the civilist like the original's `setatomic 6 89` row; every other
      // trade sent to be trained resolves it through the sim's civilist fallback.
      { jobType: JOB_CIVILIST, atomicId: EXERCISE_ATOMIC, animation: CIVILIST_EXERCISE_ANIMATION },
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
      // The hunter's own clips, timed verbatim off the extraction (`catalog/hunting.ts`).
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
    // The collector gates the economy houses + gathered goods, mirroring the extracted viking `jobEnables`
    // (see tech-graph.ts): a gated workshop stays locked until the tribe has its gatherer.
    jobEnables: SANDBOX_JOB_ENABLES,
    jobRequirements: SOLDIER_GATE,
  });
  // The standing wildlife tribes (the sandbox `animaltypes` records' owners). No tech graph and no
  // hitpoints row: an animal's HP pool comes from its animal record, not the tribe table.
  for (const tribe of SANDBOX_ANIMAL_TRIBES) {
    tribes.set(tribe.typeId, { typeId: tribe.typeId, id: tribe.id });
  }
  for (const tribe of extras.tribes ?? []) {
    if (!tribes.has(tribe.typeId)) {
      // Extra tribes (enemy raiders, wildlife) carry no tech graph - an empty edge list gates nothing, so their
      // buildings stay enabled without needing an enabler settler.
      tribes.set(tribe.typeId, { typeId: tribe.typeId, id: tribe.id, hitpoints: HUMAN_HITPOINTS });
    }
  }
  return tribes;
}
