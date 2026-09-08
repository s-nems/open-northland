import type { CommandEnvelope } from '@open-northland/sim';

/** An envelope with the position the session gave it inside its tick; unique within that tick. */
export interface TickCommand {
  readonly envelope: CommandEnvelope;
  readonly sequence: number;
}

/** Every input that applies at `tick`; complete by definition, so once it exists the tick may run. */
export interface TickFrame {
  readonly tick: number;
  readonly commands: readonly TickCommand[];
}

/** The seam between a client and whoever decides when a command applies: the transport assigns the tick
 *  and the position within it, never the caller, whose arrival order two clients would disagree about. */
export interface SessionTransport {
  /** Hand over an authorized envelope. `fromTick` is the tick the local sim had reached when it was
   *  issued. */
  submit(envelope: CommandEnvelope, fromTick: number): void;
  /** The complete input frame for `tick`, or null while it is still unknown, which is what stops a
   *  client from running ahead of the session. Asked once per tick, in ascending order. */
  take(tick: number): TickFrame | null;
}
