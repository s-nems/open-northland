import {
  aiControlEntity,
  ComputerOperations,
  type ComputerOperationsState,
  Health,
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
import { isOpen, type OperationEnv, type OperationHandler } from './lifecycle.js';
import { raidHandler } from './raid.js';

export { enter, isOpen, type Opened, type OperationEnv, type OperationHandler } from './lifecycle.js';

type Handlers = { readonly [K in OperationKind]: OperationHandler<Extract<Operation, { kind: K }>> };

/** Every kind's handler: a new kind is one entry here and one in `OPERATION_KINDS`. */
const HANDLERS: Handlers = { assault: assaultHandler, raid: raidHandler };

const FIRST_ID = 1;

function emptyState(): ComputerOperationsState {
  const readyAt = {} as Record<OperationKind, number>;
  for (const kind of OPERATION_KINDS) readyAt[kind] = 0;
  return { nextId: FIRST_ID, operations: [], readyAt };
}

export function operationsOf(world: World, seat: number): DeepReadonly<ComputerOperationsState> | null {
  const carrier = aiControlEntity(world, seat);
  return carrier === null ? null : (world.tryGet(carrier, ComputerOperations) ?? null);
}

/** Whether `e` is still a man `seat` can order: alive, a person, its own, and not taken by a map task. */
function stillServes(world: World, seat: number, claimed: ReadonlySet<Entity>, e: Entity): boolean {
  return (
    world.has(e, Person) &&
    (world.tryGet(e, Health)?.hitpoints ?? 0) > 0 &&
    world.tryGet(e, Owner)?.player === seat &&
    !claimed.has(e)
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
  // Written only when an operation runs, ends or opens, so a seat with none changes nothing.
  const held = world.tryGet(carrier, ComputerOperations);
  if (held?.operations.some((op) => !isOpen(op) || HANDLERS[op.kind].phase === phase)) {
    const state = world.mut(carrier, ComputerOperations);
    state.operations = state.operations.filter((op) => isOpen(op) || op.since >= ctx.tick);
    const claimed = mapAiSoldierClaims(world, seat);
    for (const op of state.operations) {
      if (!isOpen(op) || HANDLERS[op.kind].phase !== phase) continue;
      op.members = op.members.filter((e) => stillServes(world, seat, claimed, e));
      commands.push(...stepOf(env, op));
      if (!isOpen(op)) state.readyAt[op.kind] = ctx.tick + HANDLERS[op.kind].cooldownTicks;
    }
  }
  const members = operationMembersOf(world, seat);
  let left = free.filter((e) => !members.has(e));
  for (const kind of OPERATION_KINDS) {
    const handler = HANDLERS[kind];
    const now = world.tryGet(carrier, ComputerOperations);
    if (handler.phase !== phase || ctx.tick < (now?.readyAt[kind] ?? 0)) continue;
    if (now?.operations.some((op) => op.kind === kind && isOpen(op))) continue;
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

function stepOf(env: OperationEnv, op: Operation): readonly PlayerCommand[] {
  switch (op.kind) {
    case 'assault':
      return HANDLERS.assault.step(env, op);
    case 'raid':
      return HANDLERS.raid.step(env, op);
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
  /** A raid's flank waypoints and leg, head count at the start, people struck and killed. */
  readonly raid: {
    readonly waypoints: readonly { readonly hx: number; readonly hy: number }[];
    readonly leg: number;
    readonly startMen: number;
    readonly struck: number;
    readonly killed: number;
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
  }));
}
