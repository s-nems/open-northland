import type { SessionTransport, TickCommand, TickFrame } from '@open-northland/lockstep';
import type { CommandEnvelope } from '@open-northland/sim';
import type { ClientMessage, WireFrame } from './messages.js';

export interface RelayTransportOptions {
  readonly send: (message: ClientMessage) => void;
  /** The sim's envelope validator. An envelope it refuses is dropped on every client alike, so a bad
   *  payload from one client cannot split the session. */
  readonly parseEnvelope: (value: unknown) => CommandEnvelope;
  readonly onDropped?: (tick: number, reason: string) => void;
}

/** The client's side of a relayed session: commands go up with the tick they were issued on, frames come
 *  down and are held until the driver asks for their tick. */
export class RelayTransport implements SessionTransport {
  private readonly frames = new Map<number, WireFrame>();
  private lastTaken = 0;
  private readonly send: RelayTransportOptions['send'];
  private readonly parseEnvelope: RelayTransportOptions['parseEnvelope'];
  private readonly onDropped: RelayTransportOptions['onDropped'];

  constructor(options: RelayTransportOptions) {
    this.send = options.send;
    this.parseEnvelope = options.parseEnvelope;
    this.onDropped = options.onDropped;
  }

  /** Frames received and not yet run: how far this client trails the relay's clock. */
  get bufferedTicks(): number {
    return this.frames.size;
  }

  submit(envelope: CommandEnvelope, fromTick: number): void {
    if (envelope.origin !== 'player') {
      throw new Error(`a relayed session carries seat commands only, not ${envelope.origin}`);
    }
    this.send({ kind: 'command', envelope, fromTick });
  }

  /** A frame for a tick already run or already held is ignored: the first copy is the session's. */
  receiveFrame(frame: WireFrame): void {
    if (frame.tick <= this.lastTaken || this.frames.has(frame.tick)) return;
    this.frames.set(frame.tick, frame);
  }

  take(tick: number): TickFrame | null {
    const frame = this.frames.get(tick);
    if (frame === undefined) return null;
    this.frames.delete(tick);
    this.lastTaken = tick;
    const commands: TickCommand[] = [];
    for (const wire of frame.commands) {
      try {
        commands.push({ envelope: this.parseEnvelope(wire.envelope), sequence: wire.sequence });
      } catch (err) {
        this.onDropped?.(tick, err instanceof Error ? err.message : String(err));
      }
    }
    return { tick, commands };
  }
}
