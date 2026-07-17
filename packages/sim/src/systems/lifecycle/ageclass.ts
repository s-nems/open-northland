/**
 * Human age classes — a settler's life stage is encoded as its `jobType`, not a separate field. In *Cultures*
 * the first five `jobtypes` records are not working trades but age/sex classes a settler passes through
 * before it can take an adult job:
 *
 *   1 `baby_female`  2 `baby_male`  3 `child_female`  4 `child_male`  5 `woman`  6 `civilist` … (adult trades)
 *
 * pinned to `Data/GameSourceIncludes/logicdefines.inc` (`JOB_TYPE_HUMAN_BABY_FEMALE = 1` …
 * `JOB_TYPE_HUMAN_WOMAN = 5`, `JOB_TYPE_HUMAN_CIVILIST = 6`) and the matching `Data/logic/jobtypes.ini`
 * records. Those ids are already in the extracted `JobType` IR; this module is the sim-side recognition that
 * ids 1–4 are the non-working life stages, so a birth (`family/children.ts`) creates a baby rather
 * than an instantly-employable adult, and the JobSystem leaves a baby/child unemployed.
 *
 * The AI planner keeps an {@link Age}-bearing settler out of all economy/combat work; a BABY also skips the
 * needs-drives (the original's "a baby is cared for, it doesn't self-feed"), while a CHILD runs the needs
 * ladder (the original binds child eat/sleep animations — see `ai.ts`). The planner keys on the `Age`
 * component rather than {@link isNonWorkingAge} to dodge a jobType-id collision: a synthetic fixture's adult
 * job id can equal a real age-class id, but only a born-young settler carries `Age`. `isNonWorkingAge` stays
 * the structural id→stage predicate the JobSystem uses.
 *
 * source-basis: the age-class ids are pinned to `logicdefines.inc` + `jobtypes.ini` (no interpretation). The
 * growth cadence ({@link GROWUP_TICKS}) is approximated — no readable "grows up after N ticks" key exists.
 * A settler grows up keeping the sex it was born with (the `makeChild` order picks it; baby_female →
 * child_female → woman; baby_male → child_male → civilist).
 */

import { Age, Residence, Settler } from '../../components/index.js';
import type { Entity } from '../../ecs/world.js';
import type { System } from '../context.js';

/** The human age-class job ids (`logicdefines.inc` `JOB_TYPE_HUMAN_*`) — the data cross-reference into the
 * `JobType` IR, not control-flow opcodes. */
export const BABY_FEMALE = 1;
export const BABY_MALE = 2;
export const CHILD_FEMALE = 3;
export const CHILD_MALE = 4;

/** The adult female role (`JOB_TYPE_HUMAN_WOMAN = 5`) — a girl matures into it. It is an adult job,
 * not a non-working age class: the original employs women (domestic/`make_love`), and the marriage/child
 * mechanics pair a woman with a working man. */
export const WOMAN_JOB = 5;

/** The generic adult man (`JOB_TYPE_HUMAN_CIVILIST = 6`) — a boy matures into it (user decision
 * 2026-07-16: a grown boy is a civilian the player re-trades, not an auto-employed jobless idler). */
export const CIVILIST_JOB = 6;

/** Whether a `jobType` is a baby (the youngest, pre-child stage) — ids 1–2. */
export function isBaby(jobType: number | null): boolean {
  return jobType === BABY_FEMALE || jobType === BABY_MALE;
}

/** Whether a `jobType` is a child (between baby and adult) — ids 3–4. */
export function isChild(jobType: number | null): boolean {
  return jobType === CHILD_FEMALE || jobType === CHILD_MALE;
}

/**
 * Whether a `jobType` is a non-working age class — a baby or child (ids 1–4), not yet eligible for an adult
 * trade, and neither assigned nor counted as a worker by the JobSystem. (`woman`, id 5, is an adult role the
 * original does employ — domestic/`make_love` — so it is deliberately not a non-working stage.) `null` (an
 * idle, job-seeking adult) is not an age class — only a born stage is.
 */
export function isNonWorkingAge(jobType: number | null): boolean {
  return isBaby(jobType) || isChild(jobType);
}

/**
 * How many ticks a settler spends in each non-working life stage: a baby grows into a child after
 * `GROWUP_TICKS`, a child into an adult after another (so it is employable at `2 * GROWUP_TICKS`).
 *
 * source-basis (approximated): the original's growth cadence lives below the readable rule files — there is
 * no "grows up after N ticks" key in `jobtypes.ini`/`tribetypes.ini`/`houses.ini` — so this is an unpinned
 * constant in the {@link HUNGER_RISE_PER_TICK} mould, with the real per-stage duration as the
 * calibration-by-observation target. 8192 ticks per stage (≈ two full hunger fills) is long enough to read as
 * a childhood, short enough to exercise the maturation path headless.
 */
export const GROWUP_TICKS = 8192;

/**
 * The `Age.ticks` a settler spawned directly into an age-class job starts with, or null for an adult
 * slug (no `Age` stamped). Matched by job `id` slug, not numeric id, for the same fixture-collision
 * reason as `isFemaleJobId`. A child starts at {@link GROWUP_TICKS} — the start of its stage — so the
 * GrowthSystem neither demotes it back to a baby nor shortens its remaining childhood.
 */
export function spawnAgeTicks(jobId: string | undefined): number | null {
  switch (jobId) {
    case 'baby_female':
    case 'baby_male':
      return 0;
    case 'child_female':
    case 'child_male':
      return GROWUP_TICKS;
    default:
      return null;
  }
}

/** Whether an age-class id is a male stage — the bit preserved across the growth transition (a `baby_male`
 * grows into a `child_male`, never a `child_female`). */
function isMaleStage(jobType: number | null): boolean {
  return jobType === BABY_MALE || jobType === CHILD_MALE;
}

/**
 * GrowthSystem — age each {@link Age}-bearing settler one tick and promote it through the non-working life
 * stages: baby → child after {@link GROWUP_TICKS}, child → adult-eligible after another.
 *
 * Only a settler born young carries an {@link Age} (the FamilySystem's `birth` adds it at `ticks: 0`), so this is
 * a no-op for every settler spawned already-adult. On reaching adulthood (`jobType` cleared to `null`) the
 * `Age` component is removed — a grown settler is just an idle adult the JobSystem employs next.
 *
 * Removing `Age` on graduation is collect-then-mutate-safe: `query(Age, Settler)` yields entity ids, and the
 * removal happens after the loop, never mid-iterating a structure the query is walking.
 */
export const growthSystem: System = (world) => {
  const graduated: Entity[] = [];
  for (const e of world.query(Age, Settler)) {
    const age = world.get(e, Age);
    const settler = world.get(e, Settler);
    age.ticks += 1;
    if (age.ticks >= GROWUP_TICKS * 2) {
      // Grown to an adult — a boy becomes a civilian ({@link CIVILIST_JOB}), a girl the adult woman
      // role ({@link WOMAN_JOB}); neither is auto-employed, the player assigns work.
      settler.jobType = isMaleStage(settler.jobType) ? CIVILIST_JOB : WOMAN_JOB;
      graduated.push(e); // its Age is now meaningless
      continue;
    }
    const target = ageClassAt(age.ticks, isMaleStage(settler.jobType));
    if (target !== settler.jobType) settler.jobType = target;
  }
  for (const e of graduated) {
    world.remove(e, Age);
    // A grown child moves out: it stops counting in its parents' family slot (a homeSize-3 home would
    // otherwise silently fill with grown-up "families") and picks its own home when the player assigns
    // one (user decision 2026-07-16).
    world.remove(e, Residence);
  }
};

/**
 * The age-class `jobType` a settler that has lived `ticks` (still short of adulthood) should currently be,
 * for the given sex: a baby for the first {@link GROWUP_TICKS}, a child thereafter. A pure function of the
 * count + sex (not of how many times it ran), so re-evaluating it every tick is idempotent within a stage
 * and the promotion never double-fires.
 */
function ageClassAt(ticks: number, male: boolean): number {
  if (ticks < GROWUP_TICKS) return male ? BABY_MALE : BABY_FEMALE;
  return male ? CHILD_MALE : CHILD_FEMALE;
}
