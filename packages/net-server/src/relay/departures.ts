import { type DepartedSeatMode, ENVELOPE_VERSION, type ServerMessage } from '@open-northland/net-protocol';
import type { RoomClock } from './room-clock.js';

type Departure = { readonly nick: string; readonly player: number; readonly mode: DepartedSeatMode };

/** Shared seat handovers wait for the real built tick rather than guessing a pre-load baseline. */
export class Departures {
  private readonly pending: Departure[] = [];
  constructor(private readonly clock: RoomClock) {}

  schedule(departure: Departure, baselineKnown: boolean): number | null {
    if (!baselineKnown) {
      this.pending.push(departure);
      return null;
    }
    return this.land(departure);
  }

  flush(broadcast: (message: ServerMessage) => void): void {
    for (const departure of this.pending)
      broadcast({ kind: 'kicked', ...departure, tick: this.land(departure) });
    this.pending.length = 0;
  }

  private land({ player, mode }: Departure): number {
    if (mode !== 'ai') return this.clock.nextTick;
    return this.clock.scheduleTrusted({
      v: ENVELOPE_VERSION,
      origin: 'admin',
      command: { kind: 'setPlayerAi', player, enabled: true },
    });
  }
}
