import type { System } from './context.js';

/**
 * Not-yet-implemented placeholder systems, kept together so the execution order and intent stay
 * explicit and version-controlled. They are part of the ongoing systems/ split (see
 * docs/TECH-DEBT.md): the real systems live in their own files (command.ts, movement.ts, …) and the
 * barrel (index.ts) defines SYSTEM_ORDER over all of them. Each stub maps onto an original content
 * type (goodtypes/jobtypes/housetypes/weapontypes/animaltypes/vehicletypes/tribetypes); as one
 * becomes real it graduates to its own file, and the end-state is index.ts = barrel + SYSTEM_ORDER.
 */
const todo =
  (name: string): System =>
  () => {
    /* not yet implemented — see docs/ROADMAP.md */
    void name;
  };

export const timeSystem: System = todo('TimeSystem'); // advance clock / day / season
export const terrainSystem: System = todo('TerrainSystem'); // resource regrowth, fertility (cell graph)
export const needsSystem: System = todo('NeedsSystem'); // hunger/health + the food/goods chain
export const progressionSystem: System = todo('ProgressionSystem'); // experience + tech graph (needfor*/allow*/jobEnables*) gates jobs/goods/houses/vehicles
export const jobSystem: System = todo('JobSystem'); // match idle settlers to open jobs/workplaces
export const transportSystem: System = todo('TransportSystem'); // carriers physically haul goods between stores (no global bank)
export const constructionSystem: System = todo('ConstructionSystem'); // deliver materials, advance build, level houses
export const combatSystem: System = todo('CombatSystem'); // N-tribe combat from weapontypes/armortypes (large subsystem)
export const reproductionSystem: System = todo('ReproductionSystem'); // families/children, gated by house level capacity
export const cleanupSystem: System = todo('CleanupSystem'); // destroy dead entities (ids are NOT recycled), emit events for render/audio
