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

/** Fixed-point zero - a fresh site's `built` and `labor`. */
const NONE = fx.fromInt(0);

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
    // A pre-stocked fixture (a scene's full warehouse): every stock slot seeded to its capacity.
    ...(opts.fillStock ? { fillStock: true } : {}),
  });
}

/**
 * Place a viking building fully built DIRECTLY in the world (the sanctioned scene-setup exception, like
 * the `place*` node helpers above) and return its entity - for a scene that must reference the building
 * in a later command at build time (e.g. `upgradeBuilding`), where the command-seam placement's entity
 * id is not yet known. Stamps the same shape `placeBuilding` does: anchor Position, a built
 * {@link components.Building}, a Stockpile seeded from the type's `initial`s, a full Health pool when
 * the type has one, and the owner. Scene setup only - never a mid-run path.
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
 * Place a viking building as a FOUNDATION directly in the world and return its entity - the
 * {@link placeBuiltSandboxBuilding} twin for a scene that must reference the site it just placed (to post
 * staff to it, or to pin a builder). Stamps what a placed site carries: anchor Position, a `built = 0`
 * {@link components.Building} under an `UnderConstruction` marker, the empty Stockpile that is its
 * delivered-material hold, a 1-hitpoint Health pool when the type has one (the ConstructionSystem ramps
 * it), and the owner. Scene setup only, and a plainer site than the `placeBuilding` command's: it runs no
 * footprint eviction, clears no decor under the body, and announces no `buildingPlaced` - author it on
 * ground that is already clear.
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

/** The content building def for `typeId` (the sim's own content set), or undefined. */
export function buildingDef(
  sim: Simulation,
  typeId: number,
): Simulation['content']['buildings'][number] | undefined {
  return sim.content.buildings.find((b) => b.typeId === typeId);
}

/**
 * A building's door node - its cell anchor plus the content footprint's door offset (the sim's
 * `interactionNode`). Resolved from loaded content so the approximate (headless) and real extracted
 * (browser) footprints both land the door, which is where a staffed building's crew stands.
 */
export function buildingDoorNode(
  sim: Simulation,
  typeId: number,
  x: number,
  y: number,
): { hx: number; hy: number } {
  return doorNodeFrom(sim, typeId, cellAnchorNode(x, y));
}

/** {@link buildingDoorNode} from an anchor node already in hand. */
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
 * Spawn `count` workers at `building`'s door node, employed and BOUND to it - the scene-setup form of the
 *  player's assign order, and just as valid on a foundation as on a finished building. Without an explicit
 * `jobType` they take the building's first non-carrier worker slot read from the sim's loaded content
 * ({@link primaryWorkerJob}), so the same call staffs the building on sandbox (headless) and real
 * (browser) content, whose slot job ids differ - the sandbox rebases to `WORKER_SLOT_JOB_BASE + n`, real
 * ir.json keeps the raw id.
 *
 * Assembled directly, like {@link import('./resources.js').spawnBoundGatherer}: nothing employs a settler
 * on its own, so the crew's {@link JobAssignment} has to name the building entity, and a command-spawned
 * settler's id is not known until the command runs.
 */
export function spawnWorkersAtDoor(
  sim: Simulation,
  building: Entity,
  count: number,
  opts: {
    readonly jobType?: number;
    readonly owner?: number;
    /** Worn gear stamped on every spawned worker (e.g. a tool for the equipment-effects scene). */
    readonly equipment?: SettlerEquipment;
  } = {},
): void {
  const buildingType = sim.world.get(building, components.Building).buildingType;
  const jobType = opts.jobType ?? primaryWorkerJob(sim, buildingType);
  bindCrewAtDoor(sim, building, jobType, count, opts.owner ?? HUMAN_PLAYER, {
    ...(opts.equipment !== undefined ? { equipment: opts.equipment } : {}),
  });
}

/** Spawn `count` settlers of `jobType` on `building`'s door node and bind each to it - the one place a
 *  sandbox fixture employs anyone. */
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
 * The worker slots a scene staffs at `buildingType`, from the sim's loaded content: the craft slots of a
 * producing building (a recipe workshop or a farm), plus every carrier slot. GATHERER slots are left open -
 * a gatherer belongs on the map working its own flag, so staffing one here would only park a harvester at a
 * door. A scene wanting a gatherer on a workshop's roster binds it itself.
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

/**
 * Staff `building` to its full worker capacity: every staffable slot ({@link staffableCrewFor}) filled with
 * its own bound crew, standing at the door ({@link spawnWorkersAtDoor}). Every slot posts to THIS building,
 * carriers included - employment is directed, so a fixture says exactly who works where.
 */
export function staffBuildingFully(sim: Simulation, building: Entity, owner: number = HUMAN_PLAYER): void {
  const buildingType = sim.world.get(building, components.Building).buildingType;
  const mastery = gatherMasteryExperience(sim);
  for (const slot of staffableCrewFor(sim, buildingType)) {
    bindCrewAtDoor(sim, building, slot.jobType, slot.count, owner, {
      // A collector spawns a veteran, so real content's `needforgood` gates (iron/gold behind
      // clay/stone-digging XP) don't leave a pre-staffed crew unable to forage its wares.
      ...(slot.jobType === JOB_COLLECTOR && mastery.length > 0 ? { experience: mastery } : {}),
    });
  }
}

/** A building's primary worker-slot jobType from the sim's loaded content - its first non-{@link JOB_CARRIER}
 *  production slot, or, for a workplace staffed only by carriers (the well draws water with its carrier), the
 *  carrier slot itself. Throws only if the building employs no worker at all (a store - a scene-setup bug). */
function primaryWorkerJob(sim: Simulation, buildingType: number): number {
  const slots = buildingDef(sim, buildingType)?.workers ?? [];
  const slot = slots.find((w) => w.jobType !== JOB_CARRIER) ?? slots[0];
  if (slot === undefined) {
    throw new Error(`spawnWorkersAtDoor: building ${buildingType} has no worker slot`);
  }
  return slot.jobType;
}
