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
 * FIDELITY (faithful — params): the age-class ids are pinned to the original `logicdefines.inc`
 * constants + the `jobtypes.ini` records (no interpretation). The **growth cadence** (when a baby
 * becomes a child, a child an adult) is a *separate*, still-deferred mechanic — its timing lives below
 * the readable rule files (no readable "grows up after N ticks" key) and is calibration-by-observation;
 * see docs/FIDELITY.md. This module only fixes the *structure* (which ids are which stage), not the
 * timing. Sex selection at birth is likewise deferred (see {@link NEWBORN_AGE_CLASS}).
 */

/** The human age-class job ids (`logicdefines.inc` `JOB_TYPE_HUMAN_*`), the non-working life stages a
 * settler passes through before an adult trade. Numbered constants, not control-flow opcodes — they
 * are the data cross-reference into the `JobType` IR (CLAUDE.md: keep numeric ids as *data*). */
export const BABY_FEMALE = 1;
export const BABY_MALE = 2;
export const CHILD_FEMALE = 3;
export const CHILD_MALE = 4;

/** The job id a newborn is born at — `baby_female` (the lowest-id age class). The original picks a
 * sex per birth; we have no readable sex-determination oracle and no RNG-free source at the birth
 * site, so the youngest age class is chosen deterministically (an approximated deviation recorded in
 * docs/FIDELITY.md — the *structure* "a newborn is a baby" is pinned; *which sex* is not). */
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
