import { cellAnchorNode, type Simulation } from '@open-northland/sim';
import { resolveVikingBuilding } from '../../../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../rules.js';
import { JOB_CARRIER, JOB_COLLECTOR } from '../ids/index.js';
import { gatherMasteryExperience } from './mastery.js';

/**
 * Place a viking building (by typeId or catalog id), fully built, via the `placeBuilding` command.
 * Forced because the tech/collision gates govern the player's interactive placements, not an authored
 * scene fixture (a scene author placing two huts adjacently means it).
 */
export function placeSandboxBuilding(
  sim: Simulation,
  ref: number | string,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: { readonly underConstruction?: boolean; readonly fillStock?: boolean } = {},
): void {
  // Scenes author in whole tiles; the command seam speaks half-cell nodes.
  const node = cellAnchorNode(x, y);
  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: resolveVikingBuilding(ref).typeId,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
    force: true,
    // A construction site starts as a grey foundation a builder raises (default: fully built).
    ...(opts.underConstruction ? { underConstruction: true } : {}),
    // A pre-stocked fixture (a scene's full warehouse): every stock slot seeded to its capacity.
    ...(opts.fillStock ? { fillStock: true } : {}),
  });
}

/** The content building def for `typeId` (the sim's own content set), or undefined. */
export function buildingDef(
  sim: Simulation,
  typeId: number,
): Simulation['content']['buildings'][number] | undefined {
  return sim.content.buildings.find((b) => b.typeId === typeId);
}

/**
 * A building's door node — its cell anchor plus the content footprint's door offset (the sim's
 * `interactionNode`). Resolved from loaded content so the approximate (headless) and real extracted
 * (browser) footprints both land the door, and so a worker spawned here is bound to the building by the
 * JobSystem's adopt pass (a pre-employed settler standing at a workplace it staffs).
 */
export function buildingDoorNode(
  sim: Simulation,
  typeId: number,
  x: number,
  y: number,
): { hx: number; hy: number } {
  const anchor = cellAnchorNode(x, y);
  const door = buildingDef(sim, typeId)?.footprint?.door;
  return { hx: anchor.hx + (door?.dx ?? 0), hy: anchor.hy + (door?.dy ?? 0) };
}

/**
 * Spawn `count` pre-employed workers at a building's door node ({@link buildingDoorNode}) to staff its
 * primary production slot, via the raw `spawnSettler` command — node-exact, unlike
 * {@link import('./settlers.js').spawnSandboxSettler}, which rounds through the cell anchor and would drop
 * the door offset. The worker's job is the building's first non-carrier worker slot read from the sim's
 * loaded content ({@link primaryWorkerJob}), so the same call staffs the building on sandbox (headless) and
 * real (browser) content, whose slot job ids differ — the sandbox rebases to `WORKER_SLOT_JOB_BASE + n`,
 * real ir.json keeps the raw id. The adopt pass then binds them to the building on tick 1.
 */
export function spawnWorkersAtDoor(
  sim: Simulation,
  buildingType: number,
  x: number,
  y: number,
  count: number,
  owner: number = HUMAN_PLAYER,
): void {
  const door = buildingDoorNode(sim, buildingType, x, y);
  const jobType = primaryWorkerJob(sim, buildingType);
  for (let i = 0; i < count; i++) {
    sim.enqueue({ kind: 'spawnSettler', jobType, x: door.hx, y: door.hy, tribe: PRIMARY_TRIBE, owner });
  }
}

/**
 * The worker slots a scene can actually staff at `buildingType`, from the sim's loaded content: every slot
 * of a producing building (a recipe workshop or a farm — the adopt pass binds a worker standing at its
 * door), but only the carrier slots of a passive store (HQ/warehouse — never adopted, its haulers report in
 * loose via the JobSystem's pass 1b). The skipped store slots (collector/fisher/hunter) would otherwise
 * spawn employed-but-unbindable gatherers that roam the map.
 */
export function staffableCrewFor(
  sim: Simulation,
  buildingType: number,
): readonly { jobType: number; count: number }[] {
  const def = buildingDef(sim, buildingType);
  if (def === undefined) return [];
  const producing = def.recipes.length > 0 || def.produces.length > 0;
  return def.workers.filter((slot) => producing || slot.jobType === JOB_CARRIER);
}

/**
 * Staff a building to its full worker capacity: for every staffable slot ({@link staffableCrewFor}) spawn
 * `count` settlers of the slot's job at the door, via the raw `spawnSettler` command (node-exact, like
 * {@link spawnWorkersAtDoor}). Production workers are bound by the adopt pass on tick 1; carriers take the
 * first open transport post in canonical building order (pass 1b), so with every placement staffed this way
 * each carrier slot in the settlement fills even when an individual carrier posts to a neighbour.
 */
export function staffBuildingFully(
  sim: Simulation,
  buildingType: number,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
): void {
  const door = buildingDoorNode(sim, buildingType, x, y);
  const mastery = gatherMasteryExperience(sim);
  for (const slot of staffableCrewFor(sim, buildingType)) {
    for (let i = 0; i < slot.count; i++) {
      sim.enqueue({
        kind: 'spawnSettler',
        jobType: slot.jobType,
        x: door.hx,
        y: door.hy,
        tribe: PRIMARY_TRIBE,
        owner,
        // A collector spawns a veteran, so real content's `needforgood` gates (iron/gold behind
        // clay/stone-digging XP) don't leave a pre-staffed crew unable to forage its wares.
        ...(slot.jobType === JOB_COLLECTOR && mastery.length > 0 ? { experience: mastery } : {}),
      });
    }
  }
}

/** A building's primary worker-slot jobType from the sim's loaded content — its first non-{@link JOB_CARRIER}
 *  production slot, or, for a workplace staffed only by carriers (the well draws water with its carrier), the
 *  carrier slot itself. Throws only if the building employs no worker at all (a store — a scene-setup bug). */
function primaryWorkerJob(sim: Simulation, buildingType: number): number {
  const slots = buildingDef(sim, buildingType)?.workers ?? [];
  const slot = slots.find((w) => w.jobType !== JOB_CARRIER) ?? slots[0];
  if (slot === undefined) {
    throw new Error(`spawnWorkersAtDoor: building ${buildingType} has no worker slot`);
  }
  return slot.jobType;
}
