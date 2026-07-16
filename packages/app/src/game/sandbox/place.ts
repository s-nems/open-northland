import {
  type Command,
  cellAnchorNode,
  components,
  type Entity,
  fx,
  type ResourceNodeSpec,
  type SettlerEquipment,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { resolveVikingBuilding } from '../../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../rules.js';
import { GATHERERS, type GathererSpec, JOB_CARRIER, JOB_IDLE, weaponEquipmentFor } from './ids/index.js';

const { DeliveryFlag, Position, WorkFlag } = components;

/**
 * A gatherer's reasonable work radius around its flag (integer node-distance). Sourced from the sim's
 * {@link components.DEFAULT_WORK_FLAG_RADIUS} so a scene-bound flag and a `setWorkFlag`-placed flag share
 * one value — a named approximation (the original's collector work-area size is not decoded), and since each
 * gatherable good is unique per lane the job-atomic gate keeps a radius overlap from ever crossing trades.
 */
export const GATHERER_WORK_RADIUS = components.DEFAULT_WORK_FLAG_RADIUS;

/**
 * The sandbox world-population helpers scenes and the vertical slice share. Buildings, settlers and
 * resource nodes all go through the one command seam at runtime (`placeBuilding` / `spawnSettler` /
 * `placeResource`) — the admin/debug palette and a future scenario editor spawn through them so a mid-run
 * placement stays replay-faithful. The `place*` helpers below instead build a node directly (the
 * sanctioned `sim.world` exception): they run as scene setup, before tick 0, where the command log is
 * empty and determinism is unaffected — the same "authored fixture state" stance as a decoded map's
 * `sethouse`/landscape records. Do not copy the direct-store pattern into render glue or a mid-run path
 * (packages/app/AGENTS.md, one-way flow) — use {@link resourceCommand} there instead.
 */

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
 * {@link spawnSandboxSettler}, which rounds through the cell anchor and would drop the door offset. The
 * worker's job is the building's first non-carrier worker slot read from the sim's loaded content
 * ({@link primaryWorkerJob}), so the same call staffs the building on sandbox (headless) and real
 * (browser) content, whose slot job ids differ — the sandbox rebases to `WORKER_SLOT_JOB_BASE + n`,
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
  const producing = def.recipe !== undefined || def.produces.length > 0;
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
  for (const slot of staffableCrewFor(sim, buildingType)) {
    for (let i = 0; i < slot.count; i++) {
      sim.enqueue({
        kind: 'spawnSettler',
        jobType: slot.jobType,
        x: door.hx,
        y: door.hy,
        tribe: PRIMARY_TRIBE,
        owner,
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

/** Spawn a settler with the given job via the `spawnSettler` command. */
export function spawnSandboxSettler(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: {
    readonly hitpoints?: number;
    readonly weaponTypeId?: number;
    readonly equipment?: SettlerEquipment;
  } = {},
): void {
  const node = cellAnchorNode(x, y);
  // A warrior with no explicit loadout still gets its class weapon in the equipment slot (so its Broń
  // row + drawn weapon match), derived from the job; an explicit `equipment` wins untouched.
  const equipment = opts.equipment ?? weaponEquipmentFor(jobType);
  sim.enqueue({
    kind: 'spawnSettler',
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
    ...(opts.hitpoints !== undefined ? { hitpoints: opts.hitpoints } : {}),
    ...(opts.weaponTypeId !== undefined ? { weaponTypeId: opts.weaponTypeId } : {}),
    ...(equipment !== undefined ? { equipment } : {}),
  });
}

/**
 * Spawn an unemployed settler (jobType null) directly (scene setup, pre-tick-0) and return it. Unlike
 * {@link spawnSandboxSettler} (which spawns a settler already doing a named job), an idle settler is the
 * one the JobSystem's second pass employs — it binds an idle settler to the first canonical building with an
 * open worker slot (lowest job id first). This is how a passive store's carrier slots get staffed: a
 * warehouse/HQ is not adopted by a settler standing at its door (adopt only pins recipe workshops + farms),
 * so its haulers arrive as idle settlers the JobSystem assigns. Built via {@link systems.createSettler} then
 * re-idled, because the `spawnSettler` command has no null-job form.
 */
export function spawnIdleSettler(
  sim: Simulation,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType: JOB_IDLE,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
  });
  if (e === null) throw new Error('spawnIdleSettler: createSettler failed');
  sim.world.get(e, components.Settler).jobType = null; // re-idle so the JobSystem's assign pass employs it
  return e;
}

/**
 * Resolve a gatherer's resource-node {@link ResourceNodeSpec} at a half-cell node (`x`/`y` are node
 * coords, like every sim command) — the one place the app's felling/deposit balance constants become a
 * node's starting yield + harvest lifecycle marker. Shared by the pre-tick-0 direct helper (which
 * converts its scene tile to a node first) and the runtime {@link resourceCommand} (whose caller already
 * holds node coords), so a scene-placed tree and a debug-spawned tree are the same node. A `fell` good is
 * a chop-it-down tree, a `mine` good a finite deposit, a `pick` good a pluck-whole node.
 * Exported for the decoded-map spawner ({@link import('./map-spawn.js')}), which resolves the same node
 * spec for a map's placed objects.
 */
export function resourceSpecFor(g: GathererSpec, x: number, y: number): ResourceNodeSpec {
  switch (g.mode) {
    case 'fell':
      // Wood is the only felled good; its per-node yield + chops-to-fell are catalog constants (not
      // carried on the GathererSpec), so the fell branch reads them directly.
      return {
        good: g.good,
        x,
        y,
        remaining: WOOD_YIELD_PER_NODE,
        harvestAtomic: g.atomic,
        felling: { chopsLeft: WOOD_CHOPS_TO_FELL },
      };
    case 'mine': {
      const units = g.depositUnits ?? 0;
      if (units <= 0) throw new Error(`resourceSpecFor: '${g.id}' needs positive depositUnits`);
      const strikesPerUnit = g.strikesPerUnit ?? 0;
      if (strikesPerUnit <= 0) throw new Error(`resourceSpecFor: '${g.id}' needs positive strikesPerUnit`);
      return {
        good: g.good,
        x,
        y,
        remaining: units,
        harvestAtomic: g.atomic,
        deposit: { levels: g.depositLevels ?? 0, strikesPerUnit },
      };
    }
    case 'pick':
      return { good: g.good, x, y, remaining: 1, harvestAtomic: g.atomic };
  }
}

/** Create a resource node directly (scene setup, pre-tick-0). Throws on a good with no footprint —
 *  a scene setup bug, not recoverable — unlike the runtime command which skips it. */
function placeResourceDirect(sim: Simulation, spec: ResourceNodeSpec, what: string): void {
  if (systems.createResourceNode(sim.world, sim.content, spec) === null) {
    throw new Error(`${what}: missing resource footprint for good ${spec.good}`);
  }
}

/**
 * Place a gatherer's resource node directly (scene setup, pre-tick-0) — a felled tree, a mined deposit,
 * or a pluck-whole node, chosen from the gatherer's own {@link GathererSpec.mode} by `resourceSpecFor`
 * (so the caller doesn't re-dispatch on the mode). Scenes author in whole tiles (`x`/`y`), so the tile is
 * converted to its anchor node before assembly — the same tile→node seam `spawnSandboxSettler` uses.
 * Throws on a good with no footprint (a scene-setup bug), unlike the runtime {@link resourceCommand}.
 */
export function placeResourceNode(sim: Simulation, g: GathererSpec, x: number, y: number): void {
  const node = cellAnchorNode(x, y);
  placeResourceDirect(sim, resourceSpecFor(g, node.hx, node.hy), `placeResourceNode(${g.id})`);
}

/**
 * Place a wild berry bush directly (scene setup, pre-tick-0) and return it — the bush twin of
 * {@link placeResourceNode}. Scenes author in whole tiles (`x`/`y`); the tile is converted to its anchor
 * node before assembly. `gfxIndex` is the render-variant tag (a real fruited-bush `[GfxLandscape]` index,
 * so the browser scene draws real bush art through the {@link buildBerryBushBinding} join); it is inert in
 * the headless test (no render). The bush spawns ripe — a caller wanting a bare/regrowing bush mutates the
 * returned entity's {@link components.BerryBush} directly (still pre-tick-0 authored state).
 */
export function placeSandboxBerryBush(sim: Simulation, x: number, y: number, gfxIndex?: number): Entity {
  const node = cellAnchorNode(x, y);
  return systems.createBerryBush(sim.world, {
    x: node.hx,
    y: node.hy,
    ...(gfxIndex !== undefined ? { gfxIndex } : {}),
  });
}

/**
 * Build a `placeResource` command for a good at a half-cell node — the runtime spawn path (the
 * admin/debug palette, a future scenario editor): the node is created through the mutation seam on the
 * next tick, so a mid-run placement stays replay-faithful (unlike the direct helper, sound only before
 * tick 0). `x`/`y` are node coords, the space the UI's `clientToTile` already resolves to. Returns null
 * for a good with no gatherer spec (not a spawnable resource).
 */
export function resourceCommand(good: number, x: number, y: number): Command | null {
  const g = GATHERERS.find((gg) => gg.good === good);
  if (g === undefined) return null;
  return { kind: 'placeResource', ...resourceSpecFor(g, x, y) };
}

/**
 * Drop a loose good pile on the ground via the `dropGood` command (the runtime mutation seam, so a
 * scene-authored drop and a player-tool drop are the same replay-faithful path). Scenes author in whole
 * tiles; the command speaks half-cell nodes. The pile is the felled-trunk shape (Stockpile + GroundDrop),
 * so with no carriers on the map it simply sits where it lands.
 */
export function dropSandboxGood(sim: Simulation, good: number, x: number, y: number, amount: number): void {
  const node = cellAnchorNode(x, y);
  sim.enqueue({ kind: 'dropGood', good, x: node.hx, y: node.hy, amount });
}

/** A drop-off flag: a pure {@link DeliveryFlag} marker at the given tile (it stores nothing — the harvest
 *  piles on the ground around it as separate heaps, so moving the flag never moves the goods). Returns the
 *  flag entity so a gatherer can be bound to it ({@link spawnBoundGatherer}). */
export function placeFlag(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, DeliveryFlag, {}); // a designated collection point → render draws its flag above the heaps
  return e;
}

/**
 * Spawn a gatherer bound to its own `flag` directly (scene setup, pre-tick-0) and return it. A bound
 * gatherer must be assembled directly — via {@link systems.createSettler}, the settler twin of the
 * `placeResourceNode` helper — rather than through the `spawnSettler` command, because its {@link WorkFlag}
 * has to reference the flag entity, and a command-spawned settler's id is not known until the command runs.
 * With the binding it harvests only within `radius` of the flag, carries only what it dug, and banks it at
 * the flag. An optional `goodType` pins the gatherer to one resource (the same filter the `setGatherGood`
 * command sets), so neighbouring camps of different goods never poach each other's nodes. Throws on an
 * unknown job (a scene-setup bug, like {@link placeResourceNode}).
 */
export function spawnBoundGatherer(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  flag: Entity,
  opts: { readonly radius?: number; readonly owner?: number; readonly goodType?: number } = {},
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner: opts.owner ?? HUMAN_PLAYER,
  });
  if (e === null) throw new Error(`spawnBoundGatherer: unknown job ${jobType}`);
  sim.world.add(e, WorkFlag, {
    flag,
    radius: opts.radius ?? GATHERER_WORK_RADIUS,
    ...(opts.goodType !== undefined ? { goodType: opts.goodType } : {}),
  });
  return e;
}
