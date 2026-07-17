/**
 * The sandbox world-population helpers scenes and the vertical slice share. Buildings, settlers and
 * resource nodes all go through the one command seam at runtime (`placeBuilding` / `spawnSettler` /
 * `placeResource`) — the admin/debug palette and a future scenario editor spawn through them so a mid-run
 * placement stays replay-faithful. The `place*` helpers instead build a node directly (the sanctioned
 * `sim.world` exception): they run as scene setup, before tick 0, where the command log is empty and
 * determinism is unaffected — the same "authored fixture state" stance as a decoded map's
 * `sethouse`/landscape records. Do not copy the direct-store pattern into render glue or a mid-run path
 * (packages/app/AGENTS.md, one-way flow) — use {@link resourceCommand} there instead.
 *
 * Split by concern: buildings + their staffing ({@link import('./buildings.js')}), settler spawns
 * ({@link import('./settlers.js')}), resource nodes / bushes / drops / gathering camps
 * ({@link import('./resources.js')}), and the gather-mastery XP derivation
 * ({@link import('./mastery.js')}, also read by the decoded-map entry).
 */
export {
  buildingDef,
  buildingDoorNode,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnWorkersAtDoor,
  staffableCrewFor,
  staffBuildingFully,
} from './buildings.js';
export { gatherMasteryExperience, gatherMasteryExperienceFor } from './mastery.js';
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
export { spawnIdleSettler, spawnSandboxSettler } from './settlers.js';
