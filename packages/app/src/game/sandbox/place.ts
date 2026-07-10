import {
  type Command,
  type Entity,
  type ResourceNodeSpec,
  type SettlerEquipment,
  type Simulation,
  cellAnchorNode,
  components,
  fx,
  systems,
} from '@vinland/sim';
import { resolveVikingBuilding } from '../../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../rules.js';
import { GATHERERS, type GathererSpec, weaponEquipmentFor } from './ids.js';

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
 * resource nodes all go through the ONE command seam at RUNTIME (`placeBuilding` / `spawnSettler` /
 * `placeResource`) — the admin/debug palette and a future scenario editor spawn through them so a mid-run
 * placement stays replay-faithful. The `place*` helpers below instead build a node DIRECTLY (the
 * sanctioned `sim.world` exception): they run as scene SETUP, before tick 0, where the command log is
 * empty and determinism is unaffected — the same "authored fixture state" stance as a decoded map's
 * `sethouse`/landscape records. Do not copy the direct-store pattern into render glue or a mid-run path
 * (packages/app/AGENTS.md, one-way flow) — use {@link resourceCommand} there instead.
 */

/**
 * Place a viking building (by typeId or catalog id), fully built, via the `placeBuilding` command.
 * FORCED: scene setup is authored fixture state (like a decoded map's `sethouse` records), so it
 * loads as-is — the tech/collision gates govern the PLAYER's interactive placements, not the fixture
 * a scene is defined to start from (a scene author placing two huts adjacently means it).
 */
export function placeSandboxBuilding(
  sim: Simulation,
  ref: number | string,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
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
  });
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
 * Resolve a gatherer's resource-node {@link ResourceNodeSpec} at a HALF-CELL NODE (`x`/`y` are node
 * coords, like every sim command) — the ONE place the app's felling/deposit balance constants become a
 * node's starting yield + harvest lifecycle marker. Shared by the pre-tick-0 direct helper (which
 * converts its scene tile to a node first) and the runtime {@link resourceCommand} (whose caller already
 * holds node coords), so a scene-placed tree and a debug-spawned tree are the same node. A `fell` good is
 * a chop-it-down tree, a `mine` good a finite deposit, a `pick` good a pluck-whole node.
 */
function resourceSpecFor(g: GathererSpec, x: number, y: number): ResourceNodeSpec {
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
      return {
        good: g.good,
        x,
        y,
        remaining: units,
        harvestAtomic: g.atomic,
        deposit: { levels: g.depositLevels ?? 0 },
      };
    }
    case 'pick':
      return { good: g.good, x, y, remaining: 1, harvestAtomic: g.atomic };
  }
}

/** Create a resource node DIRECTLY (scene setup, pre-tick-0). Throws on a good with no footprint —
 *  a scene setup bug, not recoverable — unlike the runtime command which skips it. */
function placeResourceDirect(sim: Simulation, spec: ResourceNodeSpec, what: string): void {
  if (systems.createResourceNode(sim.world, sim.content, spec) === null) {
    throw new Error(`${what}: missing resource footprint for good ${spec.good}`);
  }
}

/**
 * Place a gatherer's resource node DIRECTLY (scene setup, pre-tick-0) — a felled tree, a mined deposit,
 * or a pluck-whole node, chosen from the gatherer's own {@link GathererSpec.mode} by `resourceSpecFor`
 * (so the caller doesn't re-dispatch on the mode). Scenes author in whole TILES (`x`/`y`), so the tile is
 * converted to its anchor node before assembly — the same tile→node seam `spawnSandboxSettler` uses.
 * Throws on a good with no footprint (a scene-setup bug), unlike the runtime {@link resourceCommand}.
 */
export function placeResourceNode(sim: Simulation, g: GathererSpec, x: number, y: number): void {
  const node = cellAnchorNode(x, y);
  placeResourceDirect(sim, resourceSpecFor(g, node.hx, node.hy), `placeResourceNode(${g.id})`);
}

/**
 * Build a `placeResource` command for a good at a HALF-CELL NODE — the RUNTIME spawn path (the
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
 * TILES; the command speaks half-cell nodes. The pile is the felled-trunk shape (Stockpile + GroundDrop),
 * so with no carriers on the map it simply sits where it lands.
 */
export function dropSandboxGood(sim: Simulation, good: number, x: number, y: number, amount: number): void {
  const node = cellAnchorNode(x, y);
  sim.enqueue({ kind: 'dropGood', good, x: node.hx, y: node.hy, amount });
}

/** A drop-off flag: a pure {@link DeliveryFlag} marker at the given tile (it stores nothing — the harvest
 *  piles on the GROUND around it as separate heaps, so moving the flag never moves the goods). Returns the
 *  flag entity so a gatherer can be bound to it ({@link spawnBoundGatherer}). */
export function placeFlag(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, DeliveryFlag, {}); // a designated collection point → render draws its flag above the heaps
  return e;
}

/**
 * Spawn a gatherer bound to its own `flag` DIRECTLY (scene setup, pre-tick-0) and return it. A bound
 * gatherer must be assembled directly — via {@link systems.createSettler}, the settler twin of the
 * `placeResourceNode` helper — rather than through the `spawnSettler` command, because its {@link WorkFlag}
 * has to reference the flag entity, and a command-spawned settler's id is not known until the command runs.
 * With the binding it harvests only within `radius` of the flag, carries only what it dug, and banks it at
 * the flag. Throws on an unknown job (a scene-setup bug, like {@link placeResourceNode}).
 */
export function spawnBoundGatherer(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  flag: Entity,
  radius: number = GATHERER_WORK_RADIUS,
  owner: number = HUMAN_PLAYER,
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
  });
  if (e === null) throw new Error(`spawnBoundGatherer: unknown job ${jobType}`);
  sim.world.add(e, WorkFlag, { flag, radius });
  return e;
}
