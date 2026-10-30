import { Health, Person } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { isTravelling } from '../../../movement/nav-state.js';
import type { OperationEnv } from './lifecycle.js';
import { nodeOfEntity } from './raid-target.js';

// What every band an operation sends out shares: where it stands, whether it has gathered, and the walk
// orders that bring its stragglers along.

export function isAlive(world: World, e: Entity): boolean {
  return world.has(e, Person) && (world.tryGet(e, Health)?.hitpoints ?? 0) > 0;
}

/** The integer-mean node of the band. */
export function bandCentre(world: World, members: readonly Entity[]): HalfCellNode | null {
  let hx = 0;
  let hy = 0;
  let count = 0;
  for (const e of members) {
    const at = nodeOfEntity(world, e);
    if (at === null) continue;
    hx += at.hx;
    hy += at.hy;
    count++;
  }
  return count === 0 ? null : { hx: Math.floor(hx / count), hy: Math.floor(hy / count) };
}

/** Whether every man of the band stands within `radius` half-cell nodes of `at`. */
export function gatheredAt(
  world: World,
  members: readonly Entity[],
  at: HalfCellNode,
  radius: number,
): boolean {
  return members.every((e) => {
    const node = nodeOfEntity(world, e);
    return node !== null && nodeManhattan(node, at) <= radius;
  });
}

/** Walk the men of the band who are neither within `radius` of `at` nor already walking; all of them when
 *  `everyone` (a new leg or the turn home). */
export function walkTo(
  world: World,
  members: readonly Entity[],
  at: HalfCellNode,
  kind: 'moveUnit' | 'attackMoveUnit',
  everyone: boolean,
  radius: number,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const e of members) {
    if (!everyone) {
      const node = nodeOfEntity(world, e);
      if (isTravelling(world, e) || (node !== null && nodeManhattan(node, at) <= radius)) continue;
    }
    commands.push({ kind, entity: e, x: at.hx, y: at.hy });
  }
  return commands;
}

/** The operation's home node: the barracks door, else the seat's start. */
export function homeOf(env: OperationEnv): HalfCellNode {
  const { x, y } = env.terrain.coordsOf(env.home);
  return { hx: x, hy: y };
}
