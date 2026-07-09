import { type Simulation, cellAnchorNode, components, fx, systems } from '@vinland/sim';
import { HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { resolveVikingBuilding } from '../../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../rules.js';
import { GOOD_WOOD, type GathererSpec } from './ids.js';

const { Felling, MineDeposit, Position, Resource, Stockpile } = components;

/**
 * The sandbox world-population helpers scenes and the vertical slice share. Buildings + settlers go
 * through the ONE command seam (`placeBuilding`/`spawnSettler`); resource nodes and flags are the
 * sanctioned direct-`sim.world` exception — no `placeResource` command exists yet, and content setup
 * runs before tick 0, so determinism is unaffected. Do not copy this direct-store pattern into render
 * glue (packages/app/AGENTS.md, one-way flow).
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
  opts: { readonly hitpoints?: number; readonly weaponTypeId?: number } = {},
): void {
  const node = cellAnchorNode(x, y);
  sim.enqueue({
    kind: 'spawnSettler',
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
    ...(opts.hitpoints !== undefined ? { hitpoints: opts.hitpoints } : {}),
    ...(opts.weaponTypeId !== undefined ? { weaponTypeId: opts.weaponTypeId } : {}),
  });
}

/** A fellable tree: a wood resource node with the felling counter (chops-to-fell pin). */
export function placeTree(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, {
    goodType: GOOD_WOOD,
    remaining: WOOD_YIELD_PER_NODE,
    harvestAtomic: HARVEST_ATOMIC,
  });
  if (!systems.stampResourceFootprint(sim.world, sim.content, e, GOOD_WOOD)) {
    throw new Error('placeTree: missing resource footprint for wood');
  }
  sim.world.add(e, Felling, { chopsLeft: WOOD_CHOPS_TO_FELL });
}

/** A finite mined deposit (stone/clay/iron/gold) with its level ladder. */
export function placeDeposit(sim: Simulation, g: GathererSpec, x: number, y: number): void {
  const units = g.depositUnits ?? 0;
  const levels = g.depositLevels ?? 0;
  if (units <= 0) throw new Error(`placeDeposit: '${g.id}' needs positive depositUnits`);
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: g.good, remaining: units, harvestAtomic: g.atomic });
  if (!systems.stampResourceFootprint(sim.world, sim.content, e, g.good)) {
    throw new Error(`placeDeposit: missing resource footprint for ${g.id}`);
  }
  sim.world.add(e, MineDeposit, { initial: units, levels });
}

/** A single-unit pluckable node (mushrooms). */
export function placePickNode(sim: Simulation, g: GathererSpec, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: g.good, remaining: 1, harvestAtomic: g.atomic });
  if (!systems.stampResourceFootprint(sim.world, sim.content, e, g.good)) {
    throw new Error(`placePickNode: missing resource footprint for ${g.id}`);
  }
}

/** A drop-off flag: an empty stockpile at the given tile. */
export function placeFlag(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map() });
}
