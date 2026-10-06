import type { PlayerCommand } from '@open-northland/sim';

/** A click captures the current intent of each actor, independently of later selection changes. */
export interface GroundOrderTicket {
  readonly actors: ReadonlyMap<number, number>;
}

interface WaitingOrder extends GroundOrderTicket {
  readonly before: readonly WaitingOrder[];
  callback?: (() => void) | undefined;
  done: boolean;
}

export interface PendingGroundOrders {
  begin(ids: readonly number[], queued: boolean): GroundOrderTicket;
  current(ticket: GroundOrderTicket, id: number): boolean;
  /** Call also for a failed query, with an empty callback, to release its queued successors. */
  settle(ticket: GroundOrderTicket, callback: () => void): void;
  /** The shared command seam also sequences an immediate Shift-chest behind an unanswered walk. */
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
  const current = (ticket: GroundOrderTicket, id: number): boolean =>
    !disposed && ticket.actors.has(id) && ticket.actors.get(id) === (generations.get(id) ?? 0);
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
    if (!queued) {
      nextGeneration++;
      for (const id of ids) generations.set(id, nextGeneration);
    }
    const actors = new Map(ids.map((id) => [id, generations.get(id) ?? 0]));
    const ticket: WaitingOrder = { actors, before: [], done: disposed };
    const before = queued ? [...pending].filter((prior) => overlaps(ticket, prior)) : [];
    const waiting: WaitingOrder = { ...ticket, before };
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
      return command.members.map(({ entity }) => ({ id: entity, queued: command.queued === true }));
    case 'attackUnitGroup':
    case 'assignWorkerGroup':
    case 'moveVehicleGroup':
    case 'attackWithVehicleGroup':
      return command.members.map(({ entity }) => ({ id: entity, queued: false }));
    case 'moveUnit':
    case 'attackMoveUnit':
    case 'openChest':
    case 'placeSignpost':
      return [{ id: command.entity, queued: command.queued === true }];
    case 'attackUnit':
    case 'orderNeed':
    case 'equipGood':
    case 'unequipGood':
    case 'setJob':
    case 'assignWorker':
    case 'unassignWorker':
    case 'assignBuilder':
    case 'unassignBuilder':
    case 'trainSoldier':
    case 'cancelTraining':
    case 'learn':
    case 'exploreArea':
    case 'setWorkFlag':
    case 'setGatherGood':
    case 'clearHaulFlag':
    case 'marry':
    case 'attachToVehicle':
    case 'detachFromVehicle':
      return [{ id: command.entity, queued: false }];
    case 'moveVehicle':
    case 'attackWithVehicle':
    case 'stopVehicle':
    case 'dockVehicle':
      return [{ id: command.vehicle, queued: false }];
    default:
      return [];
  }
}

/** Only queued movement/chest envelopes reach this seam; preserve their atomic envelope while dropping
 * actors whose newer order superseded that click before its predecessor's answer arrived. */
function currentActors(command: PlayerCommand, current: (id: number) => boolean): PlayerCommand | undefined {
  switch (command.kind) {
    case 'moveUnitGroup':
    case 'attackMoveUnitGroup': {
      const members = command.members.filter(({ entity }) => current(entity));
      return members.length === 0 ? undefined : { ...command, members };
    }
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
