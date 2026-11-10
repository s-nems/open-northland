import type { PlayerCommand } from '@open-northland/sim';
import { diag } from '../../../diag/index.js';
import type { AnsweredOrders } from './answered.js';

/** A click captures the current intent of each actor, independently of later selection changes. */
export interface GroundOrderTicket {
  readonly actors: ReadonlyMap<number, number>;
  readonly sequence: number;
  readonly queued: boolean;
}

interface WaitingOrder extends GroundOrderTicket {
  readonly actors: Map<number, number>;
  readonly before: readonly WaitingOrder[];
  callback?: (() => void) | undefined;
  done: boolean;
}

export interface PendingGroundOrders {
  begin(ids: readonly number[], queued: boolean): GroundOrderTicket;
  /** A fresh host answer can discover an actor absent from the mirror at the original click. */
  includeActors(ticket: GroundOrderTicket, ids: readonly number[]): void;
  current(ticket: GroundOrderTicket, id: number): boolean;
  /** Call also for a failed query, with an empty callback, to release its queued successors. */
  settle(ticket: GroundOrderTicket, callback: () => void): void;
  /** The shared command seam also sequences an immediate queued order behind an unanswered click. */
  submit(command: PlayerCommand, enqueue: (command: PlayerCommand) => void): void;
  dispose(): void;
}

/** Host answers may land out of order. Latest unqueued intent wins per actor, while Shift keeps the
 * overlapping clicks in their original order. Unrelated armies never wait on each other's answers. */
export function createPendingGroundOrders(): PendingGroundOrders {
  const generations = new Map<number, number>();
  const pending = new Set<WaitingOrder>();
  let nextGeneration = 0;
  let disposed = false;
  let flushing = false;
  let active: WaitingOrder | undefined;
  const current = (ticket: GroundOrderTicket, id: number): boolean => {
    if (disposed || !ticket.actors.has(id)) return false;
    const latest = generations.get(id) ?? 0;
    // Shift follows an older intent even when that intent's vehicle alias arrives after its own
    // answer. Only a replacing intent issued after the Shift click may cancel it.
    return ticket.queued ? latest <= ticket.sequence : ticket.actors.get(id) === latest;
  };
  const overlaps = (a: WaitingOrder, b: WaitingOrder): boolean => {
    for (const id of a.actors.keys()) if (current(a, id) && current(b, id)) return true;
    return false;
  };
  const flush = (): void => {
    if (flushing || disposed) return;
    flushing = true;
    try {
      let progressed: boolean;
      do {
        progressed = false;
        for (const ticket of pending) {
          const relevant = [...ticket.actors.keys()].some((id) => current(ticket, id));
          if (
            relevant &&
            (ticket.callback === undefined ||
              ticket.before.some((prior) => !prior.done && overlaps(ticket, prior)))
          )
            continue;
          pending.delete(ticket);
          ticket.done = true;
          progressed = true;
          if (!relevant || ticket.callback === undefined) continue;
          active = ticket;
          try {
            ticket.callback();
          } finally {
            active = undefined;
          }
        }
      } while (progressed);
    } finally {
      flushing = false;
      // Actor ids are never reused by the sim. Once every answer is handled, retaining past casualties'
      // intent stamps would otherwise make this small input guard grow for the whole match.
      if (pending.size === 0) generations.clear();
    }
  };
  const begin = (ids: readonly number[], queued: boolean): WaitingOrder => {
    const sequence = ++nextGeneration;
    if (!queued) for (const id of ids) generations.set(id, sequence);
    const actors = new Map(ids.map((id) => [id, generations.get(id) ?? 0]));
    // An answer may reveal a shared vehicle later; test overlap when flushing, not only at click time.
    const before = queued ? [...pending] : [];
    const waiting: WaitingOrder = { actors, sequence, queued, before, done: disposed };
    if (!disposed) pending.add(waiting);
    flush();
    return waiting;
  };
  const settle = (ticket: GroundOrderTicket, callback: () => void): void => {
    // The public ticket deliberately exposes no mutable sequencing state.
    for (const waiting of pending) {
      if (waiting !== ticket) continue;
      waiting.callback ??= callback;
      break;
    }
    flush();
  };
  return {
    begin,
    includeActors: (ticket, ids) => {
      for (const waiting of pending) {
        if (waiting !== ticket) continue;
        for (const id of ids) {
          if (waiting.actors.has(id)) continue;
          const latest = generations.get(id) ?? 0;
          const stamp = waiting.queued && latest <= waiting.sequence ? latest : waiting.sequence;
          waiting.actors.set(id, stamp);
          if (!waiting.queued && latest <= waiting.sequence) generations.set(id, stamp);
        }
        // Do not release callbacks until the caller has finished applying this answer's aliases.
        break;
      }
    },
    current,
    settle,
    submit: (command, enqueue) => {
      if (disposed) return;
      const effects = orderActors(command);
      const origin = active;
      const own = origin !== undefined && effects.every(({ id }) => current(origin, id));
      if (!own && effects.length > 0 && effects.every(({ queued }) => queued)) {
        const ticket = begin(
          effects.map(({ id }) => id),
          true,
        );
        settle(ticket, () => {
          const narrowed = currentActors(command, (id) => current(ticket, id));
          if (narrowed !== undefined) enqueue(narrowed);
        });
        return;
      }
      if (!own) {
        nextGeneration++;
        for (const { id, queued } of effects) if (!queued) generations.set(id, nextGeneration);
      }
      // Dispatch the replacing command before releasing any newly unblocked continuation.
      enqueue(command);
      flush();
    },
    dispose: () => {
      disposed = true;
      pending.clear();
      generations.clear();
    },
  };
}

/**
 * Run `then` on a click's `answer` in click order among the pending clicks of the same `actors`, with
 * whether a newer order has since replaced each actor's click. Without a seam the answer runs as it lands.
 */
export function afterClickAnswer<T>(
  pending: PendingGroundOrders | undefined,
  answered: AnsweredOrders,
  actors: readonly number[],
  queued: boolean,
  answer: Promise<T>,
  then: (value: T, current: (actor: number) => boolean) => void,
): void {
  if (pending === undefined) {
    answered.after(answer, (value) => then(value, () => true));
    return;
  }
  const ticket = pending.begin(actors, queued);
  // An unanswered click still settles its ticket, so the clicks queued behind it go on.
  const settled = answer.then(
    (value): { readonly value: T } => ({ value }),
    (error: unknown) => {
      diag.warn('orders', 'a click went unanswered by the host', { error: String(error) });
      return null;
    },
  );
  answered.after(settled, (result) =>
    pending.settle(ticket, () => {
      if (result !== null) then(result.value, (actor) => pending.current(ticket, actor));
    }),
  );
}

interface OrderActor {
  readonly id: number;
  readonly queued: boolean;
}

/** Commands which direct an errand supersede an unanswered walk. Stance, regeneration, naming and
 * production settings preserve it, just as they preserve a walk already running in the simulation. */
function orderActors(command: PlayerCommand): OrderActor[] {
  switch (command.kind) {
    case 'unitActionGroup':
      return command.members.flatMap(({ entity }) => orderActors({ ...command.action, entity }));
    case 'unitOrdersGroup':
      return command.members.flatMap(({ entity, actions }) =>
        actions.flatMap((action) => orderActors({ ...action, entity })),
      );
    case 'moveUnitGroup':
    case 'attackMoveUnitGroup':
    case 'moveVehicleGroup':
    case 'attackUnitGroup':
    case 'attackWithVehicleGroup':
      return command.members.map(({ entity }) => ({ id: entity, queued: command.queued === true }));
    case 'assignWorkerGroup':
    case 'attachToVehicleGroup':
      return command.members.map(({ entity }) => ({ id: entity, queued: false }));
    case 'moveUnit':
    case 'attackMoveUnit':
    case 'attackUnit':
    case 'openChest':
    case 'claimAnimal':
    case 'placeSignpost':
    case 'orderNeed':
    case 'equipGood':
    case 'assignBuilder':
    case 'trainSoldier':
    case 'explore':
    case 'attachToVehicle':
      return [{ id: command.entity, queued: command.queued === true }];
    case 'unequipGood':
    case 'setJob':
    case 'assignWorker':
    case 'unassignWorker':
    case 'unassignBuilder':
    case 'cancelTraining':
    case 'learn':
    case 'setWorkFlag':
    case 'setGatherGood':
    case 'clearHaulFlag':
    case 'marry':
    case 'detachFromVehicle':
      return [{ id: command.entity, queued: false }];
    case 'moveVehicle':
    case 'dockVehicle':
    case 'attackWithVehicle':
    case 'loadIntoVehicle':
    case 'unloadPeople':
      return [{ id: command.vehicle, queued: command.queued === true }];
    case 'stopVehicle':
      return [{ id: command.vehicle, queued: false }];
    default:
      return [];
  }
}

/** Only queued envelopes reach this seam; preserve each atomic envelope while dropping actors whose newer
 * order superseded that click before its predecessor's answer arrived. */
function currentActors(command: PlayerCommand, current: (id: number) => boolean): PlayerCommand | undefined {
  switch (command.kind) {
    case 'moveUnitGroup':
    case 'attackMoveUnitGroup':
    case 'moveVehicleGroup': {
      const members = command.members.filter(({ entity }) => current(entity));
      return members.length === 0 ? undefined : { ...command, members };
    }
    case 'attackUnitGroup':
    case 'attackWithVehicleGroup': {
      const members = command.members.filter(({ entity }) => current(entity));
      return members.length === 0 ? undefined : { ...command, members };
    }
    case 'moveVehicle':
    case 'dockVehicle':
    case 'attackWithVehicle':
    case 'loadIntoVehicle':
    case 'unloadPeople':
      return current(command.vehicle) ? command : undefined;
    case 'unitActionGroup': {
      const members = command.members.filter(({ entity }) => current(entity));
      return members.length === 0 ? undefined : { ...command, members };
    }
    case 'unitOrdersGroup': {
      const members = command.members.filter(({ entity }) => current(entity));
      return members.length === 0 ? undefined : { ...command, members };
    }
    default:
      return 'entity' in command && current(command.entity) ? command : undefined;
  }
}
