import { type ClientMessage, type ServerMessage, saveOrdersText } from '@open-northland/net-protocol';
import { type Deliver, isSynced, type Member, type Refusal } from './member.js';
import type { Resync } from './resync.js';
import type { RoomClock } from './room-clock.js';

export class SaveOrders {
  constructor(
    private readonly clock: RoomClock,
    private readonly history: Resync,
    private readonly initialTick: () => number | null,
    private readonly deliver: Deliver,
  ) {}

  capture(member: Member, request: Extract<ClientMessage, { kind: 'saveOrders' }>): Refusal {
    if (!isSynced(member)) return 'save orders require a connected, loaded and synced member';
    if (request.world !== member.world) return 'save orders belong to another world generation';
    const initial = this.initialTick();
    if (initial === null || request.tick < initial) return 'save orders predate the initial world tick';
    if (request.tick > member.ackedTick || request.tick > this.clock.tick)
      return 'save orders require an acknowledged emitted tick';
    const emitted = this.history.framesAfter(request.tick);
    if (emitted === null) return 'save orders are no longer retained; retry from the current world';
    const frames = [...emitted, ...this.clock.pendingFrames()].filter((frame) => frame.commands.length > 0);
    try {
      const message: Extract<ServerMessage, { kind: 'saveOrders' }> = {
        kind: 'saveOrders',
        id: request.id,
        tick: request.tick,
        frames,
      };
      saveOrdersText(message);
      // A detached copy: no command accepted after this reply can reach into its frames.
      this.deliver(member, structuredClone(message));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'save order capture failed';
    }
  }
}

/** A malformed capture can still name its request; never echo an unvalidated identifier. */
export function saveOrdersRequestId(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null || !('kind' in raw) || raw.kind !== 'saveOrders')
    return undefined;
  if (!('id' in raw) || typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || raw.id < 0)
    return undefined;
  return raw.id;
}
