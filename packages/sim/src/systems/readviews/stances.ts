// Pure, terminal **read views** for military stances — the `MILITARY_MODE` enum the CombatSystem's
// stance-gated engagement reads, plus the **job → default stance** lookup stamped at spawn / job-change.
// Kept beside the other data-defined taxonomies (`classes.ts`/`tribes.ts`): a stance is a per-unit
// behavior mode, and *which* mode a fresh unit starts in is a data-shaped classification of its job.

import { HUNTER_JOB } from './tribes.js';

/**
 * The original's **military behavior modes** — `logicdefines.inc` ~l.1107
 * `MILITARY_MODE_{NONE 0, ATTACK 1, DEFEND 2, IGNORE 3, FLEE 4}` (the shipped Funatics header — the
 * enum is data-pinned, verbatim). A unit's {@link import('../../components/combat.js').Stance} carries
 * one; the CombatSystem gates auto-engagement on it (the *behavior* per mode is approximated — no oracle —
 * see source basis). Kept as named constants so no combat/UI code inlines the raw ids (project rule:
 * no magic numbers for domain ids).
 *
 *  - **NONE** — no assigned mode. The defaults never produce it; a unit set to it is treated as passive
 *    (like {@link MILITARY_MODE.IGNORE}) so a stray `NONE` never becomes an accidental aggressor.
 *  - **ATTACK** — auto-acquire the nearest enemy in sight, chase, and fight (the warrior's mode).
 *  - **DEFEND** — engage only enemies inside a small radius of the anchor tile; never chase past a leash;
 *    return to the anchor when clear (a guard holding a position).
 *  - **IGNORE** — never auto-engage (the scout's mode); an explicit attack order still works.
 *  - **FLEE** — run away from the nearest threat (the civilian's mode).
 */
export const MILITARY_MODE = {
  NONE: 0,
  ATTACK: 1,
  DEFEND: 2,
  IGNORE: 3,
  FLEE: 4,
} as const;

/** Whether `mode` is one of the five data-pinned {@link MILITARY_MODE} ids — the validity gate the
 *  `setStance` command uses to reject a bad mode (a recoverable bad input, skipped-but-logged). */
export function isMilitaryMode(mode: number): boolean {
  return (
    mode === MILITARY_MODE.NONE ||
    mode === MILITARY_MODE.ATTACK ||
    mode === MILITARY_MODE.DEFEND ||
    mode === MILITARY_MODE.IGNORE ||
    mode === MILITARY_MODE.FLEE
  );
}

/**
 * The **scout** trade — `jobtypes.ini` `type 27` / `logicdefines.inc` `JOB_TYPE_HUMAN_SCOUT 27`, a
 * non-combat explorer. Its default stance is {@link MILITARY_MODE.IGNORE} (it wanders without picking
 * fights), the pin style of `HUNTER_JOB`. Kept next to {@link defaultStanceForJob} that reads it.
 */
const SCOUT_JOB = 27;

/** The **soldier** job-id band — `jobtypes.ini` soldiers 31..41 (unarmed / wooden+iron spear / short+long
 *  sword / short+long saber / small+big axe / short+long bow); every one defaults to
 *  {@link MILITARY_MODE.ATTACK}. A half-open-ish inclusive `[lo, hi]` band (the combat roster is a
 *  contiguous id range in the original data — the *Combat roster* fact in docs/plans/combat.md). */
const SOLDIER_JOB_MIN = 31;
const SOLDIER_JOB_MAX = 41;

/** The **hero** job-id band — `jobtypes.ini` heroes 42..47; like soldiers they default to
 *  {@link MILITARY_MODE.ATTACK}. Kept separate from the soldier band (a distinct roster segment) though
 *  they share the default, so the table stays legible if the two ever diverge. */
const HERO_JOB_MIN = 42;
const HERO_JOB_MAX = 47;

/**
 * The **default military stance** a settler of `jobType` starts in — stamped on every OWNED settler at
 * spawn and re-stamped on a profession change (the `setStance` command overrides it afterwards). A
 * **data-shaped lookup** (a classification of the job id, not a chain of bespoke per-unit branches),
 * keyed on the pinned job-id bands:
 *
 *  - **soldiers** ({@link SOLDIER_JOB_MIN}..{@link SOLDIER_JOB_MAX}) + **heroes**
 *    ({@link HERO_JOB_MIN}..{@link HERO_JOB_MAX}) → {@link MILITARY_MODE.ATTACK} (fighters engage on sight);
 *  - **scout** ({@link SCOUT_JOB}) → {@link MILITARY_MODE.IGNORE} (explores without fighting);
 *  - **hunter** (`HUNTER_JOB` 15) → {@link MILITARY_MODE.IGNORE} **toward humans** — it does not auto-fight
 *    enemy players, but its animal-hunting predation drive is separate and stays (the CombatSystem exempts a
 *    hunter's catchable-prey acquisition from the IGNORE gate);
 *  - **every other civilian job** (and a jobless/idle settler, `jobType` 0 or null — a child spawns jobless)
 *    → {@link MILITARY_MODE.FLEE} (civilians run from danger).
 *
 * source-basis: the mode ids are data-pinned; the **assignment of a mode to a job** is the user's observation
 * of the original (observed-approximation) — the readable data carries no per-job military-mode field —
 * so the whole table is a calibration-pending default (source basis "Combat stance defaults"). Pure of
 * world/RNG/wall-clock: a total function of the integer job id (`HUNTER_JOB` pinned in `tribes.ts`, imported
 * to keep the single hunter-id source).
 */
export function defaultStanceForJob(jobType: number | null): number {
  if (jobType === null) return MILITARY_MODE.FLEE; // a jobless settler / child is a civilian → flee
  if (jobType >= SOLDIER_JOB_MIN && jobType <= SOLDIER_JOB_MAX) return MILITARY_MODE.ATTACK; // soldiers
  if (jobType >= HERO_JOB_MIN && jobType <= HERO_JOB_MAX) return MILITARY_MODE.ATTACK; // heroes
  if (jobType === SCOUT_JOB) return MILITARY_MODE.IGNORE; // the scout explores, never picks fights
  if (jobType === HUNTER_JOB) return MILITARY_MODE.IGNORE; // ignores humans; its animal hunt drive stays
  return MILITARY_MODE.FLEE; // every other civilian job runs from danger
}
