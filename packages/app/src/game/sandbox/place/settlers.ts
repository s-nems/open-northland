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
  // A warrior with no explicit loadout still gets its class weapon in the equipment slot (so its Broń
  // row + drawn weapon match), derived from the job; an explicit `equipment` wins untouched.
  const equipment = opts.equipment ?? weaponEquipmentFor(jobType, sim.content.goods);
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
 * Spawn a settler of `jobType` directly (scene setup, pre-tick-0, the sanctioned direct-store
 * exception, see ./index.js) and return it. Unlike the `spawnSettler` command, the entity id is known
 * at build time, so a scene can address it in orders and layer authored state (needs, `Age`) on it.
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
 * Spawn an unemployed settler (jobType null) directly (scene setup, pre-tick-0) and return it - the
 * colonist a fixture hands the player to trade and post, where {@link spawnSandboxSettler} spawns one
 * already doing a named job. It does no work until something employs it, which only an `assignWorker`
 * order does. {@link JOB_IDLE} is the command wire form of `jobType: null` - the sim normalizes it at
 * creation, so the spawn lands trade-less as is.
 */
export function spawnIdleSettler(
  sim: Simulation,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
): Entity {
  return spawnSettlerDirect(sim, JOB_IDLE, x, y, owner);
}
