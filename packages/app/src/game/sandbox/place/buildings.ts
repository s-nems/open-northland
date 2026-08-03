import { footprintCellDx } from '@open-northland/data';
import {
  cellAnchorNode,
  components,
  type Entity,
  fx,
  nodeOfPosition,
  ONE,
  positionOfNode,
  type SettlerEquipment,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { resolveVikingBuilding } from '../../../catalog/buildings.js';
import { JOB_CARRIER, JOB_COLLECTOR } from '../../../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../rules.js';
import { workerRoleOf } from '../worker-roles.js';
import { gatherMasteryExperience } from './mastery.js';

const NONE = fx.fromInt(0);

/**
 * Forced, because the tech and collision gates govern the player's interactive placements, not an
 * authored scene fixture.
 */
export function placeSandboxBuilding(
  sim: Simulation,
  ref: number | string,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: { readonly fillStock?: boolean } = {},
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
    ...(opts.fillStock ? { fillStock: true } : {}),
  });
}

/**
 * Direct scene assembly, never a mid-run path: stamps the same shape as the `placeBuilding` command but
 * returns the entity, which a scene needs when a later command must reference the building it placed.
 */
export function placeBuiltSandboxBuilding(
  sim: Simulation,
  ref: number | string,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: { readonly fillStock?: boolean } = {},
): Entity {
  const { Building, Health, Owner, Position, Stockpile } = components;
  const typeId = resolveVikingBuilding(ref).typeId;
  const def = buildingDef(sim, typeId);
  const node = cellAnchorNode(x, y);
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(node.hx, node.hy));
  sim.world.add(e, Building, { buildingType: typeId, tribe: PRIMARY_TRIBE, built: ONE, level: 0 });
  const amounts = new Map<number, number>();
  for (const slot of def?.stock ?? []) {
    const seeded = opts.fillStock ? slot.capacity : slot.initial;
    if (seeded > 0) amounts.set(slot.goodType, seeded);
  }
  sim.world.add(e, Stockpile, { amounts });
  if (def?.hitpoints !== undefined) {
    sim.world.add(e, Health, { hitpoints: def.hitpoints, max: def.hitpoints });
  }
  sim.world.add(e, Owner, { player: owner });
  return e;
}

/**
 * The foundation twin of {@link placeBuiltSandboxBuilding}. A plainer site than the `placeBuilding`
 * command builds: it runs no footprint eviction, clears no decor under the body, and announces no
 * `buildingPlaced`, so author it on ground that is already clear.
 */
export function placeSandboxSite(
  sim: Simulation,
  ref: number | string,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
): Entity {
  const { Building, Health, Owner, Position, Stockpile, UnderConstruction } = components;
  const typeId = resolveVikingBuilding(ref).typeId;
  const def = buildingDef(sim, typeId);
  const node = cellAnchorNode(x, y);
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(node.hx, node.hy));
  sim.world.add(e, Building, { buildingType: typeId, tribe: PRIMARY_TRIBE, built: NONE, level: 0 });
  sim.world.add(e, UnderConstruction, { labor: NONE });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  if (def?.hitpoints !== undefined) sim.world.add(e, Health, { hitpoints: 1, max: def.hitpoints });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

export function buildingDef(
  sim: Simulation,
  typeId: number,
): Simulation['content']['buildings'][number] | undefined {
  return sim.content.buildings.find((b) => b.typeId === typeId);
}

/**
 * The cell anchor plus the footprint's door offset, where a staffed building's crew stands. Read from
 * loaded content, so the approximate and the extracted footprint both land the door.
 */
export function buildingDoorNode(
  sim: Simulation,
  typeId: number,
  x: number,
  y: number,
): { hx: number; hy: number } {
  return doorNodeFrom(sim, typeId, cellAnchorNode(x, y));
}

function doorNodeFrom(
  sim: Simulation,
  typeId: number,
  anchor: { hx: number; hy: number },
): { hx: number; hy: number } {
  const door = buildingDef(sim, typeId)?.footprint?.door;
  if (door === undefined) return { hx: anchor.hx, hy: anchor.hy };
  return { hx: anchor.hx + footprintCellDx(anchor.hy, door), hy: anchor.hy + door.dy };
}

/**
 * The scene-setup form of the player's assign order, valid on a foundation as well as on a finished
 * building. The default `jobType` is read from loaded content, so one call staffs the building on both
 * the sandbox and the real id space, whose slot job ids differ.
 */
export function spawnWorkersAtDoor(
  sim: Simulation,
  building: Entity,
  count: number,
  opts: {
    readonly jobType?: number;
    readonly owner?: number;
    readonly equipment?: SettlerEquipment;
  } = {},
): void {
  const buildingType = sim.world.get(building, components.Building).buildingType;
  const jobType = opts.jobType ?? primaryWorkerJob(sim, buildingType);
  bindCrewAtDoor(sim, building, jobType, count, opts.owner ?? HUMAN_PLAYER, {
    ...(opts.equipment !== undefined ? { equipment: opts.equipment } : {}),
  });
}

/** Stamps the binding directly rather than issuing `assignWorker`, so no slot gate runs and nothing
 *  evicts a settler off a blocked spawn: a scene author owns both. */
function bindCrewAtDoor(
  sim: Simulation,
  building: Entity,
  jobType: number,
  count: number,
  owner: number,
  spec: {
    readonly equipment?: SettlerEquipment;
    readonly experience?: ReadonlyArray<readonly [number, number]>;
  },
): void {
  const { Building, JobAssignment, Position } = components;
  const pos = sim.world.get(building, Position);
  const anchor = nodeOfPosition(pos.x, pos.y);
  const node = doorNodeFrom(sim, sim.world.get(building, Building).buildingType, anchor);
  for (let i = 0; i < count; i++) {
    const e = systems.createSettler(sim.world, sim.content, sim.rng, {
      jobType,
      x: node.hx,
      y: node.hy,
      tribe: PRIMARY_TRIBE,
      owner,
      ...(spec.experience !== undefined ? { experience: spec.experience } : {}),
      ...(spec.equipment !== undefined ? { equipment: spec.equipment } : {}),
    });
    if (e === null) throw new Error(`bindCrewAtDoor: unknown job ${jobType}`);
    sim.world.add(e, JobAssignment, { workplace: building });
  }
}

/**
 * A producing building's craft slots plus every carrier slot. Gatherer slots are left open on purpose:
 * a gatherer belongs on the map working its own flag, so staffing one here only parks it at a door.
 */
export function staffableCrewFor(
  sim: Simulation,
  buildingType: number,
): readonly { jobType: number; count: number }[] {
  const def = buildingDef(sim, buildingType);
  if (def === undefined) return [];
  const producing = def.recipes.length > 0 || def.produces.length > 0;
  return def.workers.filter(
    (slot) => slot.jobType === JOB_CARRIER || (producing && workerRoleOf(slot.jobType) !== 'gatherer'),
  );
}

/** Every slot posts to this building, carriers included, because employment is directed. */
export function staffBuildingFully(sim: Simulation, building: Entity, owner: number = HUMAN_PLAYER): void {
  const buildingType = sim.world.get(building, components.Building).buildingType;
  const mastery = gatherMasteryExperience(sim);
  for (const slot of staffableCrewFor(sim, buildingType)) {
    bindCrewAtDoor(sim, building, slot.jobType, slot.count, owner, {
      // A collector spawns a veteran, so real content's `needforgood` gates do not leave a pre-staffed
      // crew unable to forage its wares.
      ...(slot.jobType === JOB_COLLECTOR && mastery.length > 0 ? { experience: mastery } : {}),
    });
  }
}

/** The first non-carrier production slot, falling back to the carrier slot for a workplace staffed only
 *  by carriers, such as the well. */
function primaryWorkerJob(sim: Simulation, buildingType: number): number {
  const slots = buildingDef(sim, buildingType)?.workers ?? [];
  const slot = slots.find((w) => w.jobType !== JOB_CARRIER) ?? slots[0];
  if (slot === undefined) {
    throw new Error(`spawnWorkersAtDoor: building ${buildingType} has no worker slot`);
  }
  return slot.jobType;
}
