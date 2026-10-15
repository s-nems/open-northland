import {
  cellAnchorNode,
  type Entity,
  type HalfCellNode,
  type SettlerEquipment,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { JOB_IDLE } from '../../../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../rules.js';
import { weaponEquipmentFor } from '../ids/index.js';

interface SandboxSettlerOptions {
  readonly hitpoints?: number;
  readonly weaponTypeId?: number;
  readonly equipment?: SettlerEquipment;
  readonly tribe?: number;
}

function sandboxSettlerSpec(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner: number,
  opts: SandboxSettlerOptions,
) {
  const node = cellAnchorNode(x, y);
  const equipment = opts.equipment ?? weaponEquipmentFor(jobType, sim.content.goods);
  return {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: opts.tribe ?? PRIMARY_TRIBE,
    owner,
    ...(opts.hitpoints !== undefined ? { hitpoints: opts.hitpoints } : {}),
    ...(opts.weaponTypeId !== undefined ? { weaponTypeId: opts.weaponTypeId } : {}),
    ...(equipment !== undefined ? { equipment } : {}),
  };
}

/** Spawn a settler with the given job via the `spawnSettler` command. */
export function spawnSandboxSettler(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: SandboxSettlerOptions = {},
): void {
  sim.enqueueSetup({ kind: 'spawnSettler', ...sandboxSettlerSpec(sim, jobType, x, y, owner, opts) });
}

/**
 * {@link spawnSandboxSettler} created at once (scene setup, pre-tick-0) and returned, so a scene can layer
 * authored state such as a stance on it. Without the command handler it gets no stance anchor.
 */
export function spawnSandboxSettlerDirect(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: SandboxSettlerOptions = {},
): Entity {
  const spec = sandboxSettlerSpec(sim, jobType, x, y, owner, opts);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, spec, sim.names);
  if (e === null) throw new Error(`spawnSandboxSettlerDirect: unknown settler job ${jobType}`);
  return e;
}

/**
 * Spawn a settler of `jobType` directly (scene setup, pre-tick-0) and return it, so a scene can address
 * the entity in orders and layer authored state on it.
 */
export function spawnSettlerDirect(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  tribe: number = PRIMARY_TRIBE,
): Entity {
  return spawnSettlerAtNode(sim, jobType, cellAnchorNode(x, y), owner, tribe);
}

/** {@link spawnSettlerDirect} on a half-cell node, for a scene that places between tile centres. */
export function spawnSettlerAtNode(
  sim: Simulation,
  jobType: number,
  node: HalfCellNode,
  owner: number = HUMAN_PLAYER,
  tribe: number = PRIMARY_TRIBE,
): Entity {
  const e = systems.createSettler(
    sim.world,
    sim.content,
    sim.rng,
    {
      jobType,
      x: node.hx,
      y: node.hy,
      tribe,
      owner,
    },
    sim.names,
  );
  if (e === null) throw new Error(`spawnSettlerAtNode: unknown settler job ${jobType}`);
  return e;
}

/**
 * Spawn an unemployed settler directly (scene setup, pre-tick-0) and return it. It does no work until an
 * `assignWorker` order employs it.
 */
export function spawnIdleSettler(
  sim: Simulation,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
): Entity {
  return spawnSettlerDirect(sim, JOB_IDLE, x, y, owner);
}
