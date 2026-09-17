/**
 * The `place*` helpers build nodes directly in `sim.world`, the sanctioned exception for scene setup
 * before tick 0, where the command log is empty. A mid-run placement must go through the command seam
 * (`placeBuilding`, `spawnSettler`, `resourceCommand`) instead, to stay replay-faithful.
 */
export {
  buildingDef,
  buildingDoorNode,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  placeSandboxSite,
  spawnWorkersAtDoor,
  staffableCrewFor,
  staffBuildingFully,
} from './buildings.js';
export { gatherMasteryExperience } from './mastery.js';
export {
  BUSH_FRUITS_GFX,
  dropSandboxGood,
  GATHERER_WORK_RADIUS,
  placeFlag,
  placeResourceNode,
  placeSandboxBerryBush,
  resourceCommand,
  resourceSpecFor,
  spawnBoundGatherer,
} from './resources.js';
export { spawnIdleSettler, spawnSandboxSettler, spawnSettlerDirect } from './settlers.js';
export { spawnVehicleDirect } from './vehicles.js';
