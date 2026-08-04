import type { ContentSet } from '@open-northland/data';
import { Stance } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { isFighterJob, isHunterJob, isScoutJob } from './jobs.js';

/**
 * The ids are verbatim from `logicdefines.inc` `MILITARY_MODE_{NONE, ATTACK, DEFEND, IGNORE, FLEE}`.
 * Approximation: the behavior per mode has no oracle.
 *
 *  - NONE: no assigned mode, treated as passive so a stray value never becomes an aggressor.
 *  - ATTACK: auto-acquire the nearest enemy in sight, chase, and fight.
 *  - DEFEND: engage only within a radius of the anchor tile and return to it when clear.
 *  - IGNORE: never auto-engage; an explicit attack order still works.
 *  - FLEE: run away from the nearest threat.
 */
export const MILITARY_MODE = {
  NONE: 0,
  ATTACK: 1,
  DEFEND: 2,
  IGNORE: 3,
  FLEE: 4,
} as const;

export type MilitaryMode = (typeof MILITARY_MODE)[keyof typeof MILITARY_MODE];

/** The validity gate `setStance` uses to reject a bad mode as recoverable input. */
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
 * The stance stamped on an owned settler at spawn and on a profession change, which `setStance` then
 * overrides. Observation: the readable data carries no per-job military-mode field, so mapping a role to
 * a mode is an approximation of the original's behavior.
 */
export function defaultStanceForJob(content: ContentSet, jobType: number | null): MilitaryMode {
  if (jobType === null) return MILITARY_MODE.FLEE; // a jobless settler or child is a civilian
  if (isFighterJob(content, jobType)) return MILITARY_MODE.ATTACK;
  if (isScoutJob(content, jobType)) return MILITARY_MODE.IGNORE;
  if (isHunterJob(content, jobType)) return MILITARY_MODE.IGNORE; // ignores humans; its hunt drive stays
  return MILITARY_MODE.FLEE;
}

/**
 * The mode a combatant acts under, falling back to the job default when the component is missing. `NONE`
 * normalizes to the passive {@link MILITARY_MODE.IGNORE} so a stray value never becomes an aggressor.
 */
export function stanceMode(
  world: World,
  content: ContentSet,
  e: Entity,
  jobType: number | null,
): MilitaryMode {
  const s = world.tryGet(e, Stance);
  const mode = s === undefined ? defaultStanceForJob(content, jobType) : s.mode;
  return mode === MILITARY_MODE.NONE ? MILITARY_MODE.IGNORE : mode;
}
