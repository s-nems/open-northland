import type { FromWorker, WorkerSessionOptions } from '../session/worker/protocol.js';
import type { StallReports } from '../session/worker/stall-watch.js';
import {
  sessionOverPort,
  type WorkerSession,
  type WorkerSessionOpening,
} from '../session/worker/worker-session.js';

/** A hosted world request whose world the worker's client did not adopt; the client reports why. */
export class WorldNotAdoptedError extends Error {
  constructor() {
    super('the relay client did not adopt the requested world');
    this.name = 'WorldNotAdoptedError';
  }
}

/**
 * The worker sessions of one network worker's worlds, one served at a time. The world being opened
 * receives `ready` or `bootFailed`; every other session message belongs to the served world until that
 * `ready` lands. A session's `close` ends only its own world on the shared port.
 */
export class RelayedWorlds<E> {
  private opening: WorkerSessionOpening<E> | null = null;
  /** The worker client's request the opening world answers. */
  private openingRequest: number | null = null;
  private served: WorkerSessionOpening<E> | null = null;

  constructor(
    private readonly post: (message: unknown) => void,
    private readonly reports: StallReports,
  ) {}

  /** Post the world's inputs and resolve once the worker serves it; a world still opening is dropped. */
  host(requestId: number, inputs: unknown, options: WorkerSessionOptions): Promise<WorkerSession<E>> {
    this.opening?.fail(new WorldNotAdoptedError());
    const opening: WorkerSessionOpening<E> = sessionOverPort<E>(
      {
        post: (message) => {
          if (opening === this.opening || opening === this.served) this.post(message);
        },
        close: () => {
          if (opening === this.opening) this.opening = null;
          if (opening === this.served) this.served = null;
        },
      },
      options,
      this.reports,
    );
    this.opening = opening;
    this.openingRequest = requestId;
    opening.postBoot(inputs);
    return opening.ready;
  }

  route(message: FromWorker<E>, receiveMs: number): void {
    if (message.kind !== 'ready' && message.kind !== 'bootFailed') {
      this.served?.receive(message, receiveMs);
      return;
    }
    const opening = this.opening;
    this.opening = null;
    if (message.kind === 'ready') this.served = opening;
    opening?.receive(message, receiveMs);
  }

  /** The opening world will not be served: its client did not take the world `requestId` asked
   *  for, or the connection ended (no id). A request an opening already replaced changes nothing. */
  unadopted(requestId?: number): void {
    if (requestId !== undefined && requestId !== this.openingRequest) return;
    const opening = this.opening;
    this.opening = null;
    opening?.fail(new WorldNotAdoptedError());
  }

  /** The worker failed: the opening world rejects, the served one throws on its next frame. */
  fail(error: Error): void {
    this.opening?.fail(error);
    this.served?.fail(error);
  }
}
