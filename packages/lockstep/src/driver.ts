import { type CommandEnvelope, FixedTimestep, type Simulation } from '@open-northland/sim';
import type { SessionTransport } from './transport.js';

/** Tempo and pause as the session owns them, so a server clock can replace this without the HUD
 *  changing. */
export interface SessionClock {
  readonly paused: boolean;
  readonly speed: number;
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
}

export interface LockstepDriverOptions {
  readonly sim: Simulation;
  readonly transport: SessionTransport;
  /** Wall-clock multiplier the session starts at; default 1. */
  readonly speed?: number;
  readonly paused?: boolean;
}

/**
 * One client of a session: it turns elapsed display time into whole ticks and runs a tick only once
 * the transport has handed over that tick's complete input.
 */
export class LockstepDriver implements SessionClock {
  private readonly sim: Simulation;
  private readonly transport: SessionTransport;
  private readonly timestep: FixedTimestep;
  private speedMultiplier = 1;
  private pausedFlag: boolean;
  /** Held across frames so a paused or stalled session keeps drawing at the fraction it stopped on. */
  private alpha = 1;
  /** Bound once, so a frame never mints a fresh closure for the timestep. */
  private onTick: (() => void) | undefined;
  private readonly stepTick = (): boolean => {
    if (!this.runTick()) return false;
    this.onTick?.();
    return true;
  };

  constructor(options: LockstepDriverOptions) {
    this.sim = options.sim;
    this.transport = options.transport;
    this.timestep = new FixedTimestep();
    this.pausedFlag = options.paused ?? false;
    if (options.speed !== undefined) this.setSpeed(options.speed);
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  get speed(): number {
    return this.speedMultiplier;
  }

  /** Ticks the per-frame cap has discarded; the session ran slower than the requested speed. */
  get droppedTicks(): number {
    return this.timestep.droppedTicks;
  }

  get maxStepsPerFrame(): number {
    return this.timestep.maxSteps;
  }

  setPaused(paused: boolean): void {
    this.pausedFlag = paused;
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error(`session speed must be a positive number, got ${speed}`);
    }
    this.speedMultiplier = speed;
  }

  /** Hand one authorized envelope to the session, which decides the tick it applies at. */
  submit(envelope: CommandEnvelope): void {
    this.transport.submit(envelope, this.sim.tick);
  }

  /**
   * Feed elapsed real time and run the ticks it earns, as far as the session authorizes them.
   * `onTick` runs after each applied tick. Returns the renderer's interpolation alpha, which a paused
   * session holds where it stood.
   */
  advance(elapsedMs: number, onTick?: () => void): number {
    if (this.pausedFlag) return this.alpha;
    this.onTick = onTick;
    this.alpha = this.timestep.advanceWhile(elapsedMs * this.speedMultiplier, this.stepTick);
    return this.alpha;
  }

  /** Run the next tick if the session has authorized it, reporting whether it ran: tick admission
   *  without a display clock. */
  runTick(): boolean {
    if (this.pausedFlag) return false;
    const tick = this.sim.tick + 1;
    const frame = this.transport.take(tick);
    if (frame === null) return false;
    for (const command of frame.commands) this.sim.enqueueAt(command.envelope, tick, command.sequence);
    this.sim.step();
    return true;
  }
}
