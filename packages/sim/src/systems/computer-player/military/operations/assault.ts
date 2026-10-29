import { type AssaultOperation, ownerOf, WaveMarch } from '../../../../components/index.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { seatBarracksOf } from '../../base.js';
import { enter, type OperationEnv, type OperationHandler } from './lifecycle.js';

// The wave the campaign marches, registered as an operation. The march keeps its own mechanics and state
// on the barracks (`march/index.ts`); this adapter only mirrors it, after the campaign decided, so its
// men count as held and the debug view lists it. The muster gathering at the door is not an operation:
// its men stay free until they march.

/** The wave on the seat's barracks into `op`: its men, its objective, `acting` once it has arrived, and
 *  `done` once it is spent or called back. Returns whether a wave still marches. */
function mirror({ world, ctx, seat }: OperationEnv, op: AssaultOperation): boolean {
  const barracks = seatBarracksOf(world, ctx, seat);
  const march = barracks === null ? undefined : world.tryGet(barracks, WaveMarch);
  if (march === undefined) {
    op.members = [];
    enter(op, 'done', ctx.tick, 'waveSpent');
    return false;
  }
  op.members = [...march.men];
  const at = anchorNodeOf(world, march.target);
  op.target = {
    hx: at?.hx ?? op.target.hx,
    hy: at?.hy ?? op.target.hy,
    entity: march.target,
    owner: ownerOf(world, march.target) ?? op.target.owner,
  };
  const state = march.arrived ? 'acting' : 'moving';
  if (op.state !== state) enter(op, state, ctx.tick);
  return true;
}

export const assaultHandler: OperationHandler<AssaultOperation> = {
  phase: 'afterCampaign',
  cooldownTicks: 0,
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
