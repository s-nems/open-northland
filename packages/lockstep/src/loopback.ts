import type { CommandEnvelope } from '@open-northland/sim';
import type { SessionTransport, TickCommand, TickFrame } from './transport.js';

/** A loopback command applies one tick after the tick it was issued on, which is where a direct
 *  `Simulation.enqueue` applies it. */
export const LOOPBACK_DELAY_TICKS = 1;

/** The in-process transport a single-player session runs on: its own server, so every frame is complete
 *  the moment it is asked for and the sim never waits. */
export class LoopbackTransport implements SessionTransport {
  private readonly byTick = new Map<number, TickCommand[]>();

  submit(envelope: CommandEnvelope, fromTick: number): void {
    const applyTick = fromTick + LOOPBACK_DELAY_TICKS;
    const held = this.byTick.get(applyTick);
    if (held === undefined) this.byTick.set(applyTick, [{ envelope, sequence: 0 }]);
    else held.push({ envelope, sequence: held.length });
  }

  take(tick: number): TickFrame {
    const commands = this.byTick.get(tick);
    if (commands === undefined) return { tick, commands: [] };
    this.byTick.delete(tick);
    return { tick, commands };
  }
}
