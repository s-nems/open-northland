import {
  cellAnchorNode,
  components,
  type Entity,
  type SettlerEquipment,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../rules.js';
import { JOB_IDLE, weaponEquipmentFor } from '../ids/index.js';

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
