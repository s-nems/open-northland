import {
  type AssaultOperation,
  type OperationTarget,
  ownerOf,
  WaveMarch,
} from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { playerSeesEntity } from '../../../vision/gates.js';
import { seatBarracksOf } from '../../base.js';
import { rememberedBuildings } from '../../knowledge/intel/index.js';
import { enter, type OperationEnv, type OperationHandler } from './lifecycle.js';

// The wave the campaign marches, registered as an operation. The march keeps its own mechanics and state
// on the barracks (`march/index.ts`); this adapter only mirrors it, after the campaign decided, so its
// men count as held and the debug view lists it. The muster gathering at the door is not an operation:
// its men stay free until they march.

/** The wave on the seat's barracks into `op`: its men, its objective, `acting` once it has been sent in, and
 *  `done` once it is spent or called back. Returns whether a wave still marches. */
function mirror(env: OperationEnv, op: AssaultOperation): boolean {
  const { world, ctx, seat } = env;
  const barracks = seatBarracksOf(world, ctx, seat);
  const march = barracks === null ? undefined : world.tryGet(barracks, WaveMarch);
  if (march === undefined) {
    op.members = [];
    enter(op, 'done', ctx.tick, 'waveSpent');
    return false;
  }
  op.members = [...march.men];
  op.target = believedTarget(env, march.target, op.target);
  const state = march.gatherAt === null ? 'acting' : 'moving';
  if (op.state !== state) enter(op, state, ctx.tick);
  return true;
}

/** Where and whose `target` is as the seat believes it: read live while it sees it, else as it remembers
 *  the building, else as `held` last recorded it. */
function believedTarget(
  { world, ctx, seat }: OperationEnv,
  target: Entity,
  held: OperationTarget,
): OperationTarget {
  const at = anchorNodeOf(world, target);
  const owner = ownerOf(world, target);
  if (at !== null && owner !== undefined && playerSeesEntity(world, ctx.fog, seat, target))
    return { hx: at.hx, hy: at.hy, entity: target, owner };
  const remembered = rememberedBuildings(world, seat).find((b) => b.entity === target);
  if (remembered !== undefined)
    return { hx: remembered.hx, hy: remembered.hy, entity: target, owner: remembered.owner };
  return { ...held, entity: target };
}

export const assaultHandler: OperationHandler<AssaultOperation> = {
  phase: 'afterCampaign',
  cooldownTicks: () => 0,
  step(env, op) {
    mirror(env, op);
    return [];
  },
  open(env, _free, id) {
    const op: AssaultOperation = {
      id,
      kind: 'assault',
      state: 'moving',
      since: env.ctx.tick,
      members: [],
      target: { hx: 0, hy: 0, entity: null, owner: null },
      reason: null,
    };
    return mirror(env, op) ? { op, commands: [] } : null;
  },
};
