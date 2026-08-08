import {
  cellAnchorNode,
  type Entity,
  type SettlerEquipment,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { JOB_IDLE } from '../../../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../rules.js';
import { weaponEquipmentFor } from '../ids/index.js';

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
  const equipment = opts.equipment ?? weaponEquipmentFor(jobType, sim.content.goods);
  sim.enqueueSetup({
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
 * Spawn a settler of `jobType` directly (scene setup, pre-tick-0) and return it, so a scene can address
 * the entity in orders and layer authored state on it.
 */
export function spawnSettlerDirect(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner,
  });
  if (e === null) throw new Error(`spawnSettlerDirect: unknown settler job ${jobType}`);
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
