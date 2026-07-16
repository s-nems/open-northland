export const JOB_IDLE = 0;
// The collector — the original's single outdoor gatherer trade (`jobtypes.ini` type 8). One collector
// fells wood, mines every deposit, and picks mushrooms (its real `allowedAtomics` cover all six harvest
// atomics), so the sandbox's per-good {@link import('./gatherers.js').GATHERERS} rows all bind this one
// job rather than a per-good gatherer trade. Real ir.json numbers it the same, so a placed collector
// resolves against either the sandbox or the real content base.
export const JOB_COLLECTOR = 8;
// The carrier/porter — the real `jobtypes.ini` type 24. Ferries goods between stores; the sim's
// job-agnostic haul fallback. Not in `ADULT_CHARACTER_BY_JOB`, so it draws the civilian body.
export const JOB_CARRIER = 24;
/** The scout (`jobtypes.ini` type 27) — erects signposts (its one allowed atomic, build-guide 43). */
export const JOB_SCOUT = 27;
// Soldier jobs ride the real viking `jobtypes.ini` ids (soldiers 31..41) so the render's job→body map
// (`ADULT_CHARACTER_BY_JOB`) draws each class's own warrior body + weapon animation set.
export const JOB_SOLDIER_UNARMED = 31; // soldier_unarmed — the fists warrior (empty-hand body, brawls)
// The base, unarmed soldier (`jobtypes.ini` type 31) is also the single profession the picker offers; a
// weapon (a later step) specializes it into a spear/sword/bow class. Same job as {@link JOB_SOLDIER_UNARMED},
// named for the picker.
export const JOB_SOLDIER = JOB_SOLDIER_UNARMED;
export const JOB_SOLDIER_SPEAR = 33; // soldier_spear_iron
export const JOB_SOLDIER_SWORD = 34; // soldier_sword_short
export const JOB_SOLDIER_BROADSWORD = 35; // soldier_sword_long
export const JOB_ARCHER = 40; // soldier_bow_short
export const JOB_ARCHER_LONG = 41; // soldier_bow_long

/**
 * Base offset the extracted building worker-slot job ids are lifted by so they clear the sandbox's own
 * functional job band (idle 0, builder 7, collector 8, carrier 24, soldiers 31..41, the picker
 * professions — all < 1000). A rebased slot job is `BASE + originalId`; the carrier keeps its own
 * {@link JOB_CARRIER} id. See {@link import('../../worker-slots.js')} `BUILDING_WORKER_SLOTS` for why the rebase is needed.
 */
export const WORKER_SLOT_JOB_BASE = 1000;

/**
 * The extracted worker-slot trades that are outdoor resource gatherers (`jobtypes.ini`: 8 collector,
 * 15 hunter, 22 fisher), keyed by their original id. This hand-classification is an approximation because
 * `ir.json` carries no role field; it agrees with `UserShouldAttachWorkPlaceAfterJobChangeFlag`.
 */
export const EXTRACTED_GATHERER_TRADES: ReadonlySet<number> = new Set([8, 15, 22]);

/** Rebase one extracted slot job clear of the sandbox band; the carrier keeps its own id. */
export function rebaseSlotJob(jobType: number): number {
  return jobType === JOB_CARRIER ? JOB_CARRIER : WORKER_SLOT_JOB_BASE + jobType;
}

/**
 * De-rebase a job id back to its raw `jobtypes.ini` id — the inverse of {@link rebaseSlotJob} for the ids
 * it lifts (>= {@link WORKER_SLOT_JOB_BASE}), leaving the functional band (builder/collector/carrier/
 * soldiers, all < BASE) untouched. The single normalization seam so a job's role is classified in one id
 * space whether it arrived as a raw real-content id or a sandbox-rebased slot id.
 */
export function canonicalJobType(jobType: number): number {
  return jobType >= WORKER_SLOT_JOB_BASE ? jobType - WORKER_SLOT_JOB_BASE : jobType;
}

/** The rebased farmer worker-slot job, with real field-loop behaviour in the sandbox content. */
export const JOB_FARMER_SLOT = WORKER_SLOT_JOB_BASE + 18;
/** The rebased miller worker-slot job used by the generic producer drive. */
export const JOB_MILLER_SLOT = WORKER_SLOT_JOB_BASE + 19;

// The builder trade — the real viking `jobtypes.ini` id 7. The planner puts this job on foundations.
export const JOB_BUILDER = 7;
// Re-exported so the sandbox id space remains the single import surface used by scenes.
export { BUILD_HOUSE_ATOMIC } from '../../../../catalog/atomics.js';
