import type { System } from './context.js';

/**
 * Not-yet-implemented placeholder systems, kept together so the execution order and intent stay
 * explicit and version-controlled. Each maps onto an original content type; as one becomes real it
 * graduates to its own file under systems/ (git history holds the graduation record).
 */
const todo =
  (name: string): System =>
  () => {
    /* not yet implemented — see docs/tickets/ */
    void name;
  };

export const timeSystem: System = todo('TimeSystem'); // advance clock / day / season
export const terrainSystem: System = todo('TerrainSystem'); // resource regrowth, fertility (cell graph)
// XP-accrual is done (progression.ts); this stub is the remaining gating/tech-graph half:
// needfor*/allow*/jobEnables* gates on jobs/goods/houses/vehicles.
export const progressionSystem: System = todo('ProgressionSystem');
export const transportSystem: System = todo('TransportSystem'); // carriers physically haul goods between stores (no global bank)
