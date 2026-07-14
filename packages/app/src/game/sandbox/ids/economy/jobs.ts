export const JOB_IDLE = 0;
export const JOB_GATHERER_WOOD = 20;
export const JOB_GATHERER_STONE = 21;
export const JOB_GATHERER_MUD = 22;
export const JOB_GATHERER_IRON = 23;
export const JOB_GATHERER_GOLD = 24;
export const JOB_GATHERER_MUSHROOM = 25;
// Deliberately outside the real soldier band (31..41) so the job→body map draws the civilian body. 26 is
// the real `jobtypes.ini` `trader_sea`, borrowed here only because it isn't in `ADULT_CHARACTER_BY_JOB`
// (so it falls to the civilian body); the real carrier id (type 24) is taken by the synthetic gatherer
// band (20..25) above.
export const JOB_CARRIER = 26;
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
 * job band (idle 0, gatherers 20..25, carrier 26, soldiers 31..41, the picker professions — all < 1000).
 * A rebased slot job is `BASE + originalId`; the carrier keeps its own {@link JOB_CARRIER} id. See
 * {@link import('../../worker-slots.js')} `BUILDING_WORKER_SLOTS` for why the rebase is needed.
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

/** The rebased farmer worker-slot job, with real field-loop behaviour in the sandbox content. */
export const JOB_FARMER_SLOT = WORKER_SLOT_JOB_BASE + 18;
/** The rebased miller worker-slot job used by the generic producer drive. */
export const JOB_MILLER_SLOT = WORKER_SLOT_JOB_BASE + 19;

// The builder trade — the real viking `jobtypes.ini` id 7. The planner puts this job on foundations.
export const JOB_BUILDER = 7;
// Re-exported so the sandbox id space remains the single import surface used by scenes.
export { BUILD_HOUSE_ATOMIC } from '../../../../catalog/atomics.js';
