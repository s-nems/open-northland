import {
  type HoldOperation,
  type OperationEndReason,
  Stance,
  seatPeaceEndTick,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { moduleBeatDue } from '../../../ai-shared/cadence.js';
import { spokenFor } from '../../../ai-shared/military/errand.js';
import { isTravelling } from '../../../movement/nav-state.js';
import { MILITARY_MODE } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { computerProfileOf, type Share } from '../../difficulty.js';
import type { IntentArea } from '../../knowledge/map-intent/index.js';
import type { HoldTuning } from '../../strategy/military.js';
import { militaryDeadlineTick } from '../deadline.js';
import { WAVE_MIN_SOLDIERS } from '../muster.js';
import { unitPoints } from '../points.js';
import { gatheredAt, homeOf, walkTo } from './band.js';
import { believedAreaDefence, friendHoldsArea, holdAreaOf, insideArea, postOf } from './hold-area.js';
import { enter, type OperationEnv, type OperationHandler } from './lifecycle.js';
import { nodeOfEntity } from './raid-target.js';

// A hold (owner ruling: hold-the-centre play is a foundation the owner tunes later): once the seat's
// military deadline has passed, a band takes the area the map rewards it for holding, keeps its men inside,
// draws more men from the army when the enemy it sees there grows, and comes home when clearly outmatched,
// to try again later. Every figure below is authored.

const SECONDS_PER_MINUTE = 60;

/** The fewest men a hold sets out with or keeps before it turns back. */
export const HOLD_MIN_MEN = 4;
/** The free men a hold always leaves at the barracks door: the smallest wave. */
export const HOLD_HOME_FLOOR_MEN = WAVE_MIN_SOLDIERS;
/** A band sets out, and reinforces, until its points reach this share of the defence believed at the
 *  area: clearly stronger than what holds it. */
export const HOLD_EDGE: Share = { num: 5, den: 4 };
/** A band turns back once the believed defence reaches this share of its points, reinforced as far as the
 *  army allows: clearly outmatched. */
export const HOLD_OUTMATCHED: Share = { num: 3, den: 2 };
/** The share of all the men it sent, in percent, a hold may lose before it turns back. */
export const HOLD_LOSS_PCT = 60;
/** How long after a hold ends before the next one forms: a retry once the enemy has moved on. */
export const HOLD_RETRY_TICKS = 5 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** How near the door the band counts as gathered, and the most it waits there. */
export const HOLD_GATHER_RADIUS_NODES = 10;
export const HOLD_FORM_TIMEOUT_TICKS = 30 * TICKS_PER_SECOND;
/** The most a band walks to its area, or home, before it counts as arrived: a large map's crossing. */
export const HOLD_MARCH_TIMEOUT_TICKS = 6 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** Every how many of the seat's decisions it looks for a hold to open: the read counts the enemies'
 *  fighters. */
export const HOLD_LOOK_EVERY_DECISIONS = 3;

const PERCENT = 100;

/** `a` reaches `share` of `b`: integer cross-multiplication. */
function reaches(a: number, b: number, share: Share): boolean {
  return a * share.den >= b * share.num;
}

function bandPoints(env: OperationEnv, members: readonly Entity[]): number {
  let points = 0;
  for (const e of members) points += unitPoints(env.world, env.ctx, e);
  return points;
}

function areaOf(op: HoldOperation): IntentArea {
  return { point: { hx: op.target.hx, hy: op.target.hy }, range: op.range };
}

/** The free men on the door's land, on no errand, past the home floor: strongest first, then by id. */
function spareMen(env: OperationEnv, free: readonly Entity[]): Entity[] {
  const { world, terrain, home } = env;
  const land = terrain.componentOf(home);
  const ready = free.filter(
    (e) => !spokenFor(world, e) && terrain.componentOf(entityNode(world, terrain, e)) === land,
  );
  return ready
    .map((e) => ({ e, points: unitPoints(world, env.ctx, e) }))
    .sort((a, b) => b.points - a.points || a.e - b.e)
    .slice(0, Math.max(0, ready.length - HOLD_HOME_FLOOR_MEN))
    .map(({ e }) => e);
}

/** Of `spare` in order, the men a band of `held` points draws: at least `atLeast` of them, and more until
 *  the band reaches {@link HOLD_EDGE} of `defence`. */
function draft(
  env: OperationEnv,
  spare: readonly Entity[],
  held: number,
  defence: number,
  atLeast: number,
): Entity[] {
  const taken: Entity[] = [];
  let points = held;
  for (const e of spare) {
    if (taken.length >= atLeast && reaches(points, defence, HOLD_EDGE)) break;
    taken.push(e);
    points += unitPoints(env.world, env.ctx, e);
  }
  return taken;
}

/** The plan's share of `spare` men, rounded up. */
function sharedMen(spare: number, tuning: HoldTuning): number {
  return Math.ceil((spare * tuning.spareShare.num) / tuning.spareShare.den);
}

function stanceOrders(world: World, men: readonly Entity[]): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const e of men) {
    if (world.tryGet(e, Stance)?.mode !== MILITARY_MODE.ATTACK)
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
  }
  return commands;
}

/** Turn the band home for `reason`. */
function withdraw(env: OperationEnv, op: HoldOperation, reason: OperationEndReason): PlayerCommand[] {
  enter(op, 'withdrawing', env.ctx.tick, reason);
  return walkTo(env.world, op.members, homeOf(env), 'moveUnit', true, HOLD_GATHER_RADIUS_NODES);
}

/** The band's men outside the area who are not already walking go back to its post. */
function keepInside(env: OperationEnv, op: HoldOperation, everyone: boolean): PlayerCommand[] {
  const { world } = env;
  const area = areaOf(op);
  const commands: PlayerCommand[] = [];
  for (const e of op.members) {
    const at = nodeOfEntity(world, e);
    if (!everyone && (isTravelling(world, e) || (at !== null && insideArea(area, at)))) continue;
    commands.push({ kind: 'attackMoveUnit', entity: e, x: op.post.hx, y: op.post.hy });
  }
  return commands;
}

/**
 * Reinforce, then judge: while the defence believed at the area outweighs the band past {@link HOLD_EDGE}
 * it draws spare men from `free`; it turns back when its posture no longer holds, the area is no longer its
 * objective, it lost {@link HOLD_LOSS_PCT} of the men it sent or fell below {@link HOLD_MIN_MEN}, or the
 * defence reaches {@link HOLD_OUTMATCHED} of it.
 */
function reinforceOrAbort(
  env: OperationEnv,
  op: HoldOperation,
  free: Entity[],
): { readonly reason: OperationEndReason | null; readonly commands: PlayerCommand[] } {
  const tuning = env.orders.hold;
  if (tuning === null) return { reason: 'postureChanged', commands: [] };
  const area = holdAreaOf(env.ctx, env.seat);
  if (area === null || area.point.hx !== op.target.hx || area.point.hy !== op.target.hy)
    return { reason: 'targetLost', commands: [] };
  const defence = believedAreaDefence(env.world, env.ctx, env.seat, area);
  let points = bandPoints(env, op.members);
  const commands: PlayerCommand[] = [];
  if (!reaches(points, defence, HOLD_EDGE)) {
    const added = draft(env, spareMen(env, free), points, defence, 0);
    if (added.length > 0) {
      const taken = new Set(added);
      const kept = free.filter((e) => !taken.has(e));
      free.length = 0;
      free.push(...kept);
      op.members = [...op.members, ...added].sort((a, b) => a - b);
      op.sentMen += added.length;
      points += bandPoints(env, added);
      commands.push(...stanceOrders(env.world, added));
    }
  }
  if (
    (op.sentMen - op.members.length) * PERCENT >= op.sentMen * HOLD_LOSS_PCT ||
    op.members.length < HOLD_MIN_MEN
  )
    return { reason: 'losses', commands };
  if (defence > 0 && reaches(defence, points, HOLD_OUTMATCHED)) return { reason: 'outmatched', commands };
  return { reason: null, commands };
}

function step(env: OperationEnv, op: HoldOperation, free: Entity[]): readonly PlayerCommand[] {
  const { world, ctx } = env;
  const tick = ctx.tick;
  if (op.members.length === 0) {
    enter(op, 'failed', tick, 'wiped');
    return [];
  }
  const home = homeOf(env);
  switch (op.state) {
    case 'forming': {
      if (env.orders.hold === null) return withdraw(env, op, 'postureChanged');
      if (
        !gatheredAt(world, op.members, home, HOLD_GATHER_RADIUS_NODES) &&
        tick - op.since < HOLD_FORM_TIMEOUT_TICKS
      )
        return walkTo(world, op.members, home, 'attackMoveUnit', false, HOLD_GATHER_RADIUS_NODES);
      enter(op, 'moving', tick);
      return keepInside(env, op, true);
    }
    case 'moving':
    case 'acting': {
      const judged = reinforceOrAbort(env, op, free);
      if (judged.reason !== null) return [...judged.commands, ...withdraw(env, op, judged.reason)];
      if (op.state === 'moving' && (arrived(world, op) || tick - op.since >= HOLD_MARCH_TIMEOUT_TICKS))
        enter(op, 'acting', tick);
      return [...judged.commands, ...keepInside(env, op, false)];
    }
    case 'withdrawing': {
      if (
        gatheredAt(world, op.members, home, HOLD_GATHER_RADIUS_NODES) ||
        tick - op.since >= HOLD_MARCH_TIMEOUT_TICKS
      ) {
        enter(op, 'done', tick);
        return [];
      }
      return walkTo(world, op.members, home, 'moveUnit', false, HOLD_GATHER_RADIUS_NODES);
    }
    case 'done':
    case 'failed':
      return [];
  }
}

/** Whether half the band or more stands inside the area. */
function arrived(world: World, op: HoldOperation): boolean {
  const area = areaOf(op);
  let inside = 0;
  for (const e of op.members) {
    const at = nodeOfEntity(world, e);
    if (at !== null && insideArea(area, at)) inside++;
  }
  return 2 * inside >= op.members.length;
}

/**
 * A new hold when the seat's posture allows one and no raid on its settlement is going on, its military
 * deadline and any lobby peace are past, the map rewards it for holding an area it can walk to, and no
 * friend holds that area already: from the spare
 * men ({@link spareMen}), the plan's share and more until the band reaches {@link HOLD_EDGE} of the
 * defence believed there, looked for on every {@link HOLD_LOOK_EVERY_DECISIONS}th decision. None with
 * fewer than {@link HOLD_MIN_MEN} or a band short of the edge.
 */
function open(env: OperationEnv, free: readonly Entity[], id: number) {
  const { world, ctx, terrain, seat, home, orders } = env;
  const tuning = orders.hold;
  if (
    tuning === null ||
    orders.posture === 'defend' ||
    !moduleBeatDue(ctx.tick, seat, HOLD_LOOK_EVERY_DECISIONS)
  )
    return null;
  const from = Math.max(
    militaryDeadlineTick(world, ctx, seat),
    seatPeaceEndTick(world, seat),
    computerProfileOf(world, seat).army.firstWaveFromTick,
  );
  if (ctx.tick < from) return null;
  const area = holdAreaOf(ctx, seat);
  if (area === null) return null;
  const spare = spareMen(env, free);
  if (spare.length < HOLD_MIN_MEN) return null;
  const post = postOf(terrain, area, terrain.componentOf(home));
  if (post === null || friendHoldsArea(world, ctx, seat, area)) return null;
  const defence = believedAreaDefence(world, ctx, seat, area);
  const members = draft(env, spare, 0, defence, sharedMen(spare.length, tuning)).sort((a, b) => a - b);
  if (members.length < HOLD_MIN_MEN || !reaches(bandPoints(env, members), defence, HOLD_EDGE)) return null;
  const op: HoldOperation = {
    id,
    kind: 'hold',
    state: 'forming',
    since: ctx.tick,
    members,
    target: { hx: area.point.hx, hy: area.point.hy, entity: null, owner: null },
    reason: null,
    range: area.range,
    post,
    sentMen: members.length,
  };
  return {
    op,
    commands: [
      ...stanceOrders(world, members),
      ...walkTo(world, members, homeOf(env), 'attackMoveUnit', false, HOLD_GATHER_RADIUS_NODES),
    ],
  };
}

export const holdHandler: OperationHandler<HoldOperation> = {
  phase: 'beforeCampaign',
  cooldownTicks: HOLD_RETRY_TICKS,
  step,
  open,
};
