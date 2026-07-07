import type { System } from './context.js';

/**
 * Not-yet-implemented placeholder systems, kept together so the execution order and intent stay
 * explicit and version-controlled. They are part of the ongoing systems/ split (see
 * docs/plans/): the real systems live in their own files (command.ts, movement.ts, …) and the
 * barrel (index.ts) defines SYSTEM_ORDER over all of them. Each stub maps onto an original content
 * type (goodtypes/jobtypes/housetypes/weapontypes/animaltypes/vehicletypes/tribetypes); as one
 * becomes real it graduates to its own file, and the end-state is index.ts = barrel + SYSTEM_ORDER.
 */
const todo =
  (name: string): System =>
  () => {
    /* not yet implemented — see docs/plans/*/
    void name;
  };

export const timeSystem: System = todo('TimeSystem'); // advance clock / day / season
export const terrainSystem: System = todo('TerrainSystem'); // resource regrowth, fertility (cell graph)
// XP-accrual is done (progression.ts: grantWorkExperience, called by AtomicSystem on a completed
// work atomic — XP is event-shaped, so it can't be a poll-driven system). This stub is the
// remaining *gating/tech-graph* half: needfor*/allow*/jobEnables* gates on jobs/goods/houses/vehicles.
export const progressionSystem: System = todo('ProgressionSystem');
// JobSystem has graduated to ./jobs.ts (assignment half — idle settlers take open workplace jobs,
// gated by needforjob XP + tech-enablement). Movement/balancing/vehicles remain later slices.
export const transportSystem: System = todo('TransportSystem'); // carriers physically haul goods between stores (no global bank)
// ConstructionSystem has graduated to ./construction.ts (the build-completion half — an under-construction
// building whose stockpile holds its full `construction` material cost consumes the materials and flips to
// built, emitting `buildingFinished`). The material-DELIVERY dispatch (carriers hauling to the site) rides
// the transport path; the home level-up trigger is a later slice.
// CombatSystem has graduated to ./combat.ts (the TARGETING half — an idle Health-bearing combatant
// swings at the nearest enemy-tribe combatant in weapon range, issuing the `attack` atomic with the
// `combatDamage`-resolved net damage). It closes the targeting->attack->hit->death loop with the
// AtomicSystem `attack` effect (the hit) + the CleanupSystem (the death). Armor-on-a-settler, the
// walk-into-melee drive, and animal/N-tribe content are later slices.
// ReproductionSystem has graduated to ./reproduction.ts (birth half — one settler per tribe per tick
// while population < housing capacity; newborns are born babies, the data-pinned age-class structure
// in ./ageclass.ts). The growth transition (baby->child->adult) remains a later slice.
// CleanupSystem has graduated to ./cleanup.ts (destroy any 0-hitpoint combatant, emit `settlerDied`
// for render/audio — entity ids are NOT recycled). The death half of the combat targeting+death loop.
