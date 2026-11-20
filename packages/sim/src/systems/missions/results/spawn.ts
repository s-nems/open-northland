import { spawnAnimalHerd, spawnSettler } from '../../spawn/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

/** How many humans one `SetHumanX` may spawn. The corpus's widest wave is 200; this only stops a
 *  corrupted count, which the original would spawn in full. */
const SPAWN_COUNT_CAP = 500;

type HumanSpawn = Extract<MissionResultOp, { opcode: 'SetHuman' | 'SetHumanX' }>;

/** Spawn `count` humans on one point through the `spawnSettler` seam: `SetHuman` places one,
 *  `SetHumanX` repeats itself. Each carries the line's object id and behaviour mask. */
export function spawnScriptedHumans(pass: MissionPass, op: HumanSpawn, count: number): void {
  const wanted = Math.min(Math.max(count, 0), SPAWN_COUNT_CAP);
  for (let i = 0; i < wanted; i++) {
    spawnSettler(pass.world, pass.ctx, {
      kind: 'spawnSettler',
      jobType: op.job,
      tribe: op.tribe,
      x: op.point.hx,
      y: op.point.hy,
      owner: op.player,
      missionId: op.humanId,
      behaviourFlags: op.behaviour,
    });
  }
}

/** Spawn one animal, not a whole `maximumgroupsize` herd - a script places creatures one line at a
 *  time, as the authored `setanimal` records do. */
export function spawnScriptedAnimal(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'SetAnimal' }>,
): void {
  spawnAnimalHerd(pass.world, pass.ctx, {
    kind: 'spawnAnimalHerd',
    tribe: op.tribe,
    x: op.point.hx,
    y: op.point.hy,
    count: 1,
    owner: op.player,
    missionId: op.objectId,
  });
}
