import type { SessionTransport, TickCommand, TickFrame } from '@open-northland/lockstep';
import type { CommandEnvelope } from '@open-northland/sim';
import type { ClientMessage, WireEnvelope, WireFrame } from './messages.js';

export interface RelayTransportOptions {
  readonly send: (message: ClientMessage) => void;
  /** The sim's envelope validator. An envelope it refuses is dropped on every client alike, so a bad
   *  payload from one client cannot split the session. */
  readonly parseEnvelope: (value: unknown) => CommandEnvelope;
  /** A dropped envelope, with the wire's authority half so a client can tell whether it was its own. */
  readonly onDropped?: (tick: number, reason: string, envelope: WireEnvelope) => void;
  /** The tick the client's world stands at; frames up to it are ignored. Default 0, a fresh world. */
  readonly fromTick?: number;
  /** Runs with each frame as the driver takes it, the moment its commands apply. */
  readonly onFrame?: (frame: TickFrame) => void;
}

/** The client's side of a relayed session: commands go up with the tick they were issued on, frames come
 *  down and are held until the driver asks for their tick. */
export class RelayTransport implements SessionTransport {
  private readonly frames = new Map<number, WireFrame>();
  private lastTaken: number;
  private readonly send: RelayTransportOptions['send'];
  private readonly parseEnvelope: RelayTransportOptions['parseEnvelope'];
  private readonly onDropped: RelayTransportOptions['onDropped'];
  private readonly onFrame: RelayTransportOptions['onFrame'];

  constructor(options: RelayTransportOptions) {
    this.send = options.send;
    this.parseEnvelope = options.parseEnvelope;
    this.onDropped = options.onDropped;
    this.onFrame = options.onFrame;
    this.lastTaken = options.fromTick ?? 0;
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
        this.onDropped?.(tick, err instanceof Error ? err.message : String(err), wire.envelope);
      }
    }
    const taken = { tick, commands };
    this.onFrame?.(taken);
    return taken;
  }
}
