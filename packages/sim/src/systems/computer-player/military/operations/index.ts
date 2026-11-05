import {
  aiControlEntity,
  ComputerOperations,
  type ComputerOperationsState,
  Health,
  isOperationOpen,
  type LandingLeg,
  OPERATION_KINDS,
  type Operation,
  type OperationEndReason,
  type OperationKind,
  type OperationState,
  Owner,
  operationMembersOf,
  Person,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { mapAiSoldierClaims } from '../../../ai-shared/military/ownership.js';
import { assaultHandler } from './assault.js';
import { holdHandler } from './hold.js';
import { landingHandler, rescueHandler } from './landing/landing.js';
import { type OperationEnv, type OperationHandler, UNDRAWN_READY_AT } from './lifecycle.js';
import { raidHandler } from './raid.js';
import { seaScoutHandler } from './sea-scout.js';

export {
  enter,
  NEVER_READY,
  type Opened,
  type OperationEnv,
  type OperationHandler,
} from './lifecycle.js';

type Handlers = { readonly [K in OperationKind]: OperationHandler<Extract<Operation, { kind: K }>> };

/** Every kind's handler: a new kind is one entry here and one in `OPERATION_KINDS`. */
const HANDLERS: Handlers = {
  assault: assaultHandler,
  hold: holdHandler,
  raid: raidHandler,
  rescue: rescueHandler,
  landing: landingHandler,
  seaScout: seaScoutHandler,
};

const FIRST_ID = 1;

function emptyState(): ComputerOperationsState {
  const readyAt = {} as Record<OperationKind, number>;
  for (const kind of OPERATION_KINDS) readyAt[kind] = UNDRAWN_READY_AT;
  return { nextId: FIRST_ID, operations: [], readyAt };
}

export function operationsOf(world: World, seat: number): DeepReadonly<ComputerOperationsState> | null {
  const carrier = aiControlEntity(world, seat);
  return carrier === null ? null : (world.tryGet(carrier, ComputerOperations) ?? null);
}

/** Whether `e` is a live person of `seat`'s. */
function ownLive(world: World, seat: number, e: Entity): boolean {
  return (
    world.has(e, Person) &&
    (world.tryGet(e, Health)?.hitpoints ?? 0) > 0 &&
    world.tryGet(e, Owner)?.player === seat
  );
}

/**
 * One decision of `phase` for the seat's operations: the terminal ones of earlier decisions dropped, every
 * open one of the phase's kinds stepped, then each kind offered the men left in `free` to open one more.
 * Returns the orders and the men the operations hold now, which the caller keeps from everyone else.
 */
export function runOperations(
  env: OperationEnv,
  phase: OperationHandler['phase'],
  free: readonly Entity[],
): { readonly commands: readonly PlayerCommand[]; readonly members: ReadonlySet<Entity> } {
  const { world, ctx, seat } = env;
  const carrier = aiControlEntity(world, seat);
  if (carrier === null) return { commands: [], members: new Set() };
  const commands: PlayerCommand[] = [];
  const heldBefore = operationMembersOf(world, seat);
  // The men no operation holds: a step may take reinforcements from them.
  const pool = free.filter((e) => !heldBefore.has(e));
  // Written only when an operation runs, ends or opens, so a seat with none changes nothing.
  const held = world.tryGet(carrier, ComputerOperations);
  if (held?.operations.some((op) => !isOperationOpen(op) || HANDLERS[op.kind].phase === phase)) {
    const state = world.mut(carrier, ComputerOperations);
    state.operations = state.operations.filter((op) => isOperationOpen(op) || op.since >= ctx.tick);
    const claimed = mapAiSoldierClaims(world, seat);
    for (const op of state.operations) {
      if (!isOperationOpen(op) || HANDLERS[op.kind].phase !== phase) continue;
      // A man a map task takes leaves the operation; its handler hands him back.
      const released = op.members.filter((e) => claimed.has(e) && ownLive(world, seat, e));
      if (released.length > 0) commands.push(...(HANDLERS[op.kind].release?.(world, released) ?? []));
      op.members = op.members.filter((e) => !claimed.has(e) && ownLive(world, seat, e));
      commands.push(...stepOf(env, op, pool));
      if (!isOperationOpen(op)) state.readyAt[op.kind] = ctx.tick + HANDLERS[op.kind].cooldownTicks(env);
    }
  }
  const members = operationMembersOf(world, seat);
  let left = pool.filter((e) => !members.has(e));
  for (const kind of OPERATION_KINDS) {
    const handler = HANDLERS[kind];
    if (handler.phase !== phase) continue;
    if (handler.firstReadyAt !== undefined) {
      const drawn = world.tryGet(carrier, ComputerOperations)?.readyAt[kind] ?? UNDRAWN_READY_AT;
      if (drawn === UNDRAWN_READY_AT) {
        const first = handler.firstReadyAt(env);
        if (first === null) continue;
        if (!world.has(carrier, ComputerOperations)) world.add(carrier, ComputerOperations, emptyState());
        world.mut(carrier, ComputerOperations).readyAt[kind] = first;
      }
    }
    const now = world.tryGet(carrier, ComputerOperations);
    if (ctx.tick < (now?.readyAt[kind] ?? 0)) continue;
    if (now?.operations.some((op) => op.kind === kind && isOperationOpen(op))) continue;
    const opened = handler.open(env, left, now?.nextId ?? FIRST_ID);
    if (opened === null) continue;
    if (now === undefined) world.add(carrier, ComputerOperations, emptyState());
    const state = world.mut(carrier, ComputerOperations);
    state.nextId++;
    state.operations.push(opened.op);
    commands.push(...opened.commands);
    const taken = new Set(opened.op.members);
    left = left.filter((e) => !taken.has(e));
  }
  return { commands, members: operationMembersOf(world, seat) };
}

function stepOf(env: OperationEnv, op: Operation, pool: Entity[]): readonly PlayerCommand[] {
  switch (op.kind) {
    case 'assault':
      return HANDLERS.assault.step(env, op, pool);
    case 'hold':
      return HANDLERS.hold.step(env, op, pool);
    case 'raid':
      return HANDLERS.raid.step(env, op, pool);
    case 'rescue':
      return HANDLERS.rescue.step(env, op, pool);
    case 'landing':
      return HANDLERS.landing.step(env, op, pool);
    case 'seaScout':
      return HANDLERS.seaScout.step(env, op, pool);
  }
}

/** One operation as a debug view shows it: plain data. */
export interface OperationView {
  readonly id: number;
  readonly kind: OperationKind;
  readonly state: OperationState;
  readonly since: number;
  readonly members: readonly Entity[];
  readonly target: {
    readonly hx: number;
    readonly hy: number;
    readonly entity: Entity | null;
    readonly owner: number | null;
  };
  readonly reason: OperationEndReason | null;
  /** A hold's radius around its target, its post, and the men it sent with every reinforcement. */
  readonly hold: {
    readonly range: number;
    readonly post: { readonly hx: number; readonly hy: number };
    readonly sentMen: number;
  } | null;
  /** A raid's flank waypoints and leg, head count at the start, people struck and killed. */
  readonly raid: {
    readonly waypoints: readonly { readonly hx: number; readonly hy: number }[];
    readonly leg: number;
    readonly startMen: number;
    readonly struck: number;
    readonly killed: number;
  } | null;
  /** A landing's or rescue's ships and where each is on its voyage, head count at the start, men set
   *  ashore. */
  readonly landing: {
    readonly ships: readonly {
      readonly vehicle: Entity;
      readonly leg: LandingLeg;
      readonly shore: { readonly hx: number; readonly hy: number };
    }[];
    readonly startShips: number;
    readonly startMen: number;
    readonly landed: number;
  } | null;
}

/** `seat`'s operations, ascending id, for a debug view; the ones ended this decision included. */
export function seatOperationsOf(world: World, seat: number): readonly OperationView[] {
  return (operationsOf(world, seat)?.operations ?? []).map((op) => ({
    id: op.id,
    kind: op.kind,
    state: op.state,
    since: op.since,
    members: [...op.members],
    target: { ...op.target },
    reason: op.reason,
    hold:
      op.kind === 'hold'
        ? { range: op.range, post: { hx: op.post.hx, hy: op.post.hy }, sentMen: op.sentMen }
        : null,
    raid:
      op.kind === 'raid'
        ? {
            waypoints: op.waypoints.map((w) => ({ hx: w.hx, hy: w.hy })),
            leg: op.leg,
            startMen: op.startMen,
            struck: op.struck.length,
            killed: op.killed,
          }
        : null,
    landing:
      op.kind === 'landing' || op.kind === 'rescue'
        ? {
            ships: op.ships.map((ship) => ({
              vehicle: ship.vehicle,
              leg: ship.leg,
              shore: { hx: ship.shore.hx, hy: ship.shore.hy },
            })),
            startShips: op.startShips,
            startMen: op.startMen,
            landed: op.landed,
          }
        : null,
  }));
}
