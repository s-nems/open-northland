// Pure, terminal read views for military stances - the `MILITARY_MODE` enum the CombatSystem's stance-gated
// engagement reads, plus the job role → default stance lookup stamped at spawn / job-change. Kept beside the
// other data-defined taxonomies (`classes/`, `jobs.ts` and `tribes/`).

import type { ContentSet } from '@open-northland/data';
import { isFighterJob, isHunterJob, isScoutJob } from './jobs.js';

/**
 * The original's military behavior modes - `logicdefines.inc` ~l.1107
 * `MILITARY_MODE_{NONE 0, ATTACK 1, DEFEND 2, IGNORE 3, FLEE 4}` (the shipped Funatics header, verbatim). A
 * unit's {@link import('../../components/combat.js').Stance} carries one; the CombatSystem gates
 * auto-engagement on it (the behavior per mode is approximated - no oracle - see source basis).
 *
 *  - **NONE** - no assigned mode. The defaults never produce it; a unit set to it is treated as passive
 *    (like {@link MILITARY_MODE.IGNORE}) so a stray `NONE` never becomes an accidental aggressor.
 *  - **ATTACK** - auto-acquire the nearest enemy in sight, chase, and fight (the warrior's mode).
 *  - **DEFEND** - engage only enemies inside a small radius of the anchor tile; never chase past a leash;
 *    return to the anchor when clear (a guard holding a position).
 *  - **IGNORE** - never auto-engage (the scout's mode); an explicit attack order still works.
 *  - **FLEE** - run away from the nearest threat (the civilian's mode).
 */
export const MILITARY_MODE = {
  NONE: 0,
  ATTACK: 1,
  DEFEND: 2,
  IGNORE: 3,
  FLEE: 4,
} as const;

/** One of the five data-pinned {@link MILITARY_MODE} ids. */
export type MilitaryMode = (typeof MILITARY_MODE)[keyof typeof MILITARY_MODE];

/** Whether `mode` is one of the five data-pinned {@link MILITARY_MODE} ids - the validity gate the
 *  `setStance` command uses to reject a bad mode (a recoverable bad input, skipped-but-logged). */
export function isMilitaryMode(mode: number): mode is MilitaryMode {
  return (
    mode === MILITARY_MODE.NONE ||
    mode === MILITARY_MODE.ATTACK ||
    mode === MILITARY_MODE.DEFEND ||
    mode === MILITARY_MODE.IGNORE ||
    mode === MILITARY_MODE.FLEE
  );
}

/**
 * The default military stance a settler of `jobType` starts in - stamped on every owned settler at spawn and
 * re-stamped on a profession change (the `setStance` command overrides it afterwards). A lookup over the
 * content-derived job roles (`readviews/jobs.ts`):
 *
 *  - **soldiers + heroes** ({@link isFighterJob}) → {@link MILITARY_MODE.ATTACK} (fighters engage on sight);
 *  - **scout** ({@link isScoutJob}) → {@link MILITARY_MODE.IGNORE} (explores without fighting);
 *  - **hunter** ({@link isHunterJob}) → {@link MILITARY_MODE.IGNORE} toward humans - it does not auto-fight
 *    enemy players, but its animal-hunting predation drive is separate and stays (the CombatSystem exempts a
 *    hunter's huntable-prey acquisition from the IGNORE gate);
 *  - **every other civilian job** (and a jobless/idle settler, `jobType` 0 or null) → {@link MILITARY_MODE.FLEE}
 *    (civilians run from danger).
 *
 * Source basis: the mode ids are data-pinned; the assignment of a mode to a job is the user's observation of
 * the original (observed-approximation) - the readable data carries no per-job military-mode field - so the
 * whole table is a calibration-pending default (source basis "Combat stance defaults").
 */
export function defaultStanceForJob(content: ContentSet, jobType: number | null): MilitaryMode {
  if (jobType === null) return MILITARY_MODE.FLEE; // a jobless settler / child is a civilian → flee
  if (isFighterJob(content, jobType)) return MILITARY_MODE.ATTACK; // soldiers + heroes engage on sight
  if (isScoutJob(content, jobType)) return MILITARY_MODE.IGNORE; // the scout explores, never picks fights
  if (isHunterJob(content, jobType)) return MILITARY_MODE.IGNORE; // ignores humans; its hunt drive stays
  return MILITARY_MODE.FLEE; // every other civilian job runs from danger
}
