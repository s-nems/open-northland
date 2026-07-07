/**
 * Human **age classes** — the data-pinned fact that a settler's life stage is encoded as its
 * `jobType`, not a separate field. In *Cultures* the first five `jobtypes` records are not working
 * trades but age/sex classes a settler passes through before it can take an adult job:
 *
 *   1 `baby_female`  2 `baby_male`  3 `child_female`  4 `child_male`  5 `woman`  6 `civilist` … (adult trades)
 *
 * pinned to `Data/GameSourceIncludes/logicdefines.inc`
 * (`JOB_TYPE_HUMAN_BABY_FEMALE = 1` … `JOB_TYPE_HUMAN_WOMAN = 5`, `JOB_TYPE_HUMAN_CIVILIST = 6`) and the
 * matching `Data/logic/jobtypes.ini` records (`name "baby_female"` … `"civilist"`). Those ids are
 * already in the extracted `JobType` IR; this module is the **sim-side recognition** that ids 1–4 are
 * the non-working life stages — so the ReproductionSystem can birth a settler at the youngest stage (a
 * baby) rather than as an instantly-employable adult, and the JobSystem leaves a baby/child unemployed
 * (a baby's `jobType` is non-null, so it is already skipped by the idle-only assignment, and no
 * workplace lists a baby/child in its `workers` slots, so one is never adopted either).
 *
 * GROWTH (the {@link growthSystem} below): a settler born young ({@link Age}-bearing) **grows up** —
 * the AI planner skips an `Age`-bearing settler so a baby/child does NOT run the adult needs-drives
 * (eat/sleep/pray), matching the original's "a baby is cared for, it doesn't self-feed", and the
 * GrowthSystem ages it baby → child → adult-eligible (its `Age` component is removed once it can work).
 * (The planner keys on the `Age` component rather than {@link isNonWorkingAge} to dodge a jobType-id
 * collision — a synthetic fixture's adult job id can equal a real age-class id, but only a born-young
 * settler carries `Age`; `isNonWorkingAge` stays the structural id→stage predicate the JobSystem uses.)
 *
 * source-basis (faithful — params; approximated — cadence): the age-class ids are pinned to the original
 * `logicdefines.inc` constants + the `jobtypes.ini` records (no interpretation). The **growth cadence**
 * ({@link GROWUP_TICKS} — how long each stage lasts) is *approximated*: its timing lives below the
 * readable rule files (no readable "grows up after N ticks" key) and is calibration-by-observation; see
 * source basis. This module fixes the *structure* (which ids are which stage) faithfully and the
 * *timing* as the recorded approximated constant. Sex selection at birth is likewise deferred (see
 * {@link NEWBORN_AGE_CLASS}); a settler grows up keeping the sex it was born with (baby_female →
 * child_female → adult; baby_male → child_male → adult).
 */

import { Age, Settler } from '../../components/index.js';
import type { Entity } from '../../ecs/world.js';
import type { System } from '../context.js';

/** The human age-class job ids (`logicdefines.inc` `JOB_TYPE_HUMAN_*`), the non-working life stages a
 * settler passes through before an adult trade. Numbered constants, not control-flow opcodes — they
 * are the data cross-reference into the `JobType` IR (AGENTS.md: keep numeric ids as *data*). */
export const BABY_FEMALE = 1;
export const BABY_MALE = 2;
export const CHILD_FEMALE = 3;
export const CHILD_MALE = 4;

/** The job id a newborn is born at — `baby_female` (the lowest-id age class). The original picks a
 * sex per birth; we have no readable sex-determination oracle and no RNG-free source at the birth
 * site, so the youngest age class is chosen deterministically (an approximated deviation recorded in
 * source basis — the *structure* "a newborn is a baby" is pinned; *which sex* is not). */
export const NEWBORN_AGE_CLASS = BABY_FEMALE;

/** Whether a `jobType` is a **baby** (the youngest, pre-child stage) — ids 1–2. */
export function isBaby(jobType: number | null): boolean {
  return jobType === BABY_FEMALE || jobType === BABY_MALE;
}

/** Whether a `jobType` is a **child** (between baby and adult) — ids 3–4. */
export function isChild(jobType: number | null): boolean {
  return jobType === CHILD_FEMALE || jobType === CHILD_MALE;
}

/**
 * Whether a `jobType` is a **non-working age class** — a baby or child (ids 1–4). A settler in one of
 * these stages is not yet eligible for an adult trade; the JobSystem must not assign or count it as
 * a worker. (`woman`, id 5, is an adult role the original does employ — domestic/`make_love` — so it
 * is deliberately NOT a non-working stage here.) `null` (an idle, job-seeking adult) is not an age
 * class — only a born stage is.
 */
export function isNonWorkingAge(jobType: number | null): boolean {
  return isBaby(jobType) || isChild(jobType);
}

/**
 * How many ticks a settler spends in each non-working life stage before advancing to the next: a baby
 * grows into a child after `GROWUP_TICKS`, a child into an adult after another `GROWUP_TICKS` (so it is
 * employable at `2 * GROWUP_TICKS`).
 *
 * source-basis (approximated — see source basis): the original's growth cadence lives below the readable
 * rule files — there is no "grows up after N ticks" key in `jobtypes.ini`/`tribetypes.ini`/`houses.ini`
 * — so this is an unpinned constant in the established hunger-rise mould ({@link HUNGER_RISE_PER_TICK}):
 * the basic "a settler is born young and matures into a worker over time" core, deterministic and
 * bounded, with the real per-stage duration as the calibration-by-observation target. 8192 ticks per
 * stage (≈ the slowest needs cadence, two full hunger fills) keeps a newborn a non-worker for a good
 * while — long enough to read as a childhood, short enough to exercise the maturation path headless.
 */
export const GROWUP_TICKS = 8192;

/** Whether an age-class id is a **male** stage (`baby_male`/`child_male`) — the bit preserved across the
 * growth transition (a `baby_male` grows into a `child_male`, never a `child_female`). */
function isMaleStage(jobType: number | null): boolean {
  return jobType === BABY_MALE || jobType === CHILD_MALE;
}

/**
 * GrowthSystem — age each {@link Age}-bearing settler one tick and **promote** it through the
 * non-working life stages as it matures: baby → child after {@link GROWUP_TICKS}, child →
 * adult-eligible after another. Closes the plan's growth transition (baby→child→adult-eligible,
 * freeing a grown child for the JobSystem) and the loop the ReproductionSystem opened — a colony's
 * newborns mature into workers rather than staying babies forever.
 *
 * Only a settler born young carries an {@link Age} (the ReproductionSystem adds it at `ticks: 0`); an
 * adult never does, so this system is a no-op for every settler spawned already-adult (the goldens, the
 * slice, `spawnSettler`). Each tick a borne settler's `ticks` increments; the moment it reaches a stage
 * boundary (`ticks >= GROWUP_TICKS * stagesPassed`) its `jobType` is promoted to the next age class
 * ({@link ageClassAt}, sex-preserving). When it grows into an adult (`jobType` cleared to `null`), its
 * `Age` component is **removed** — a grown settler is just an idle adult; the JobSystem employs it next.
 *
 * The age-class *structure* (which ids are which stage, the sex split) is faithful (pinned to
 * `logicdefines.inc`/`jobtypes.ini`); the *cadence* {@link GROWUP_TICKS} is the recorded approximated
 * constant (no readable grow-up-rate oracle — source basis).
 *
 * Determinism: a fixed integer increment and fixed stage boundaries, no RNG/wall-clock. The per-entity
 * update reads/writes only that settler's own `Age`/`Settler`, so the Settler-store iteration order
 * can't leak into the result; promotion is a pure function of the new `ticks` count. Removing the `Age`
 * component on graduation is collect-then-mutate-safe — `query(Age, Settler)` yields entity ids, and we
 * remove from the `Age` store after reading, never mid-iterating a structure the query is walking
 * (mirrors the demolish-unbind teardown discipline in AGENTS [71f13ab]).
 */
export const growthSystem: System = (world) => {
  const graduated: Entity[] = [];
  for (const e of world.query(Age, Settler)) {
    const age = world.get(e, Age);
    const settler = world.get(e, Settler);
    age.ticks += 1;
    // The age class a settler of `ticks` age should now be (sex preserved). Promote only on a real
    // change so an in-stage tick is a no-op; null = grown to an employable adult.
    const target = ageClassAt(age.ticks, isMaleStage(settler.jobType));
    if (target !== settler.jobType) {
      settler.jobType = target;
      if (target === null) graduated.push(e); // grown to an adult — its Age is now meaningless
    }
  }
  for (const e of graduated) world.remove(e, Age);
};

/**
 * The age-class `jobType` a settler that has lived `ticks` should currently be, for the given sex
 * (`male`): a **baby** for the first {@link GROWUP_TICKS}, a **child** for the next, an **adult**
 * (`null` — employable) thereafter. A pure function of the count + sex (not of how many times it ran),
 * so re-evaluating it every tick is idempotent within a stage and the promotion never double-fires.
 */
function ageClassAt(ticks: number, male: boolean): number | null {
  if (ticks < GROWUP_TICKS) return male ? BABY_MALE : BABY_FEMALE;
  if (ticks < GROWUP_TICKS * 2) return male ? CHILD_MALE : CHILD_FEMALE;
  return null; // adult-eligible
}
