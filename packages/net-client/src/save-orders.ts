import type { ClientMessage, ServerMessage } from '@open-northland/net-protocol';
import { parseCommandEnvelope, type SaveGame, withSaveContinuation } from '@open-northland/sim';

const SAVE_ORDERS_TIMEOUT_MS = 10_000;
type Orders = Extract<ServerMessage, { kind: 'saveOrders' }>;

interface Capture {
  readonly id: number;
  readonly save: SaveGame;
  readonly resolve: (save: SaveGame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** The save's world is captured before the request; its future inputs come from the relay's reply. */
export class SaveOrders {
  private nextId = 0;
  private pending: Capture | null = null;

  request(save: SaveGame, world: number, send: (message: ClientMessage) => void): Promise<SaveGame> {
    if (this.pending !== null) return Promise.reject(new Error('A save is already being captured'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.cancel('Timed out obtaining pending orders from the relay'),
        SAVE_ORDERS_TIMEOUT_MS,
      );
      this.pending = { id, save, resolve, reject, timer };
      try {
        send({ kind: 'saveOrders', id, tick: save.header.tick, world });
      } catch (error) {
        this.cancel(String(error));
      }
    });
  }

  receive(message: Orders): void {
    const pending = this.pending;
    if (pending === null || pending.id !== message.id) return;
    if (pending.save.header.tick !== message.tick) {
      this.cancel('The relay returned pending orders for another saved tick');
      return;
    }
    try {
      const continuation = message.frames.flatMap((frame) =>
        frame.commands.map(({ envelope }) => ({
          applyTick: frame.tick,
          envelope: parseCommandEnvelope(envelope),
        })),
      );
      const save = withSaveContinuation(pending.save, continuation);
      this.clear();
      pending.resolve(save);
    } catch (error) {
      this.cancel(String(error));
    }
  }

  refuse(requestId: number | undefined, reason: string): void {
    if (requestId !== undefined && this.pending?.id === requestId) this.cancel(reason);
  }

  cancel(reason: string): void {
    const pending = this.pending;
    this.clear();
    pending?.reject(new Error(reason));
  }

  private clear(): void {
    if (this.pending !== null) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
