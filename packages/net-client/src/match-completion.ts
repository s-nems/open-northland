import type { ClientMessage } from '@open-northland/net-protocol';
import type { Simulation } from '@open-northland/sim';

/** The match's end as this client sees it: the tick its own world decided on, and the tick and full
 *  hash the relay confirmed for the room. */
export class MatchCompletion {
  private confirmed: { readonly tick: number; readonly hash: string } | null = null;
  resultTick: number | null = null;
  private checkedWorld: Simulation | null = null;
  private verified = false;
  private reported = false;

  get confirmedTick(): number | null {
    return this.confirmed?.tick ?? null;
  }

  confirm(tick: number, hash: string): void {
    this.confirmed = { tick, hash };
  }

  /** The room is gone with its result. */
  clear(): void {
    this.confirmed = null;
  }

  readyTick(sim: Simulation | null): number | null {
    return this.verified && sim === this.checkedWorld ? this.confirmedTick : null;
  }

  verify(sim: Simulation | null): string | null {
    const confirmed = this.confirmed;
    if (sim === null || confirmed === null || sim.tick !== confirmed.tick || sim === this.checkedWorld)
      return null;
    this.checkedWorld = sim;
    this.verified = sim.matchEnded() && sim.hashState() === confirmed.hash;
    return this.verified ? null : 'The restored world does not match the confirmed match result';
  }

  detect(sim: Simulation | null): boolean {
    if (sim?.matchEnded() !== true) return false;
    this.resultTick = sim.tick;
    return true;
  }

  report(
    sim: Simulation | null,
    world: number,
    connected: boolean,
    send: (message: ClientMessage) => void,
  ): void {
    if (!this.detect(sim) || sim === null || this.reported || !connected) return;
    this.reported = true;
    send({ kind: 'finish', tick: sim.tick, hash: sim.hashState(), world });
  }

  reconnect(): void {
    this.reported = false;
  }

  dropWorld(): void {
    this.checkedWorld = null;
    this.verified = false;
    this.resultTick = null;
    this.reported = false;
  }
}
