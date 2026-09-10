import { MAX_COMMANDS_PER_TICK } from '@open-northland/net-protocol';

/** Weight of the newest sample in the smoothed click-to-apply time. */
const SMOOTHING = 0.25;
/** Issue stamps kept while their commands are in flight; more than this is a relay that stopped answering. */
const MAX_IN_FLIGHT = MAX_COMMANDS_PER_TICK * 4;

/**
 * Click-to-apply time for this seat's own commands. The relay keeps one member's commands in order,
 * so the oldest stamp belongs to the next command of this seat to come back in a frame.
 */
export class CommandLatency {
  private readonly issuedAt: number[] = [];
  private latestMs: number | null = null;
  private smoothedMs: number | null = null;

  /** The smoothed click-to-apply time in milliseconds; null until a command came back. */
  get clickToApplyMs(): number | null {
    return this.smoothedMs;
  }

  get lastMs(): number | null {
    return this.latestMs;
  }

  issued(now: number): void {
    if (this.issuedAt.length >= MAX_IN_FLIGHT) this.issuedAt.shift();
    this.issuedAt.push(now);
  }

  /** One of this seat's commands applied on a tick that just ran. */
  applied(now: number): void {
    const issued = this.issuedAt.shift();
    if (issued === undefined) return;
    const ms = now - issued;
    this.latestMs = ms;
    this.smoothedMs = this.smoothedMs === null ? ms : this.smoothedMs + SMOOTHING * (ms - this.smoothedMs);
  }

  /** The relay refused the oldest command in flight, so its stamp measures nothing. */
  refused(): void {
    this.issuedAt.shift();
  }
}
