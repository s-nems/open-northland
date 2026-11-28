import {
  type ExportSaveOptions,
  exportSaveGame,
  FixedTimestep,
  type LoggedCommand,
  type Simulation,
} from '@open-northland/sim';
import type { SessionDriver } from './driver.js';
import type { SessionTransport, TickCommand, TickFrame } from './transport.js';

/** The complete recorded input of a session, served tick by tick. */
export class ReplayTransport implements SessionTransport {
  /** Recorded commands per tick, in recording order within the tick. */
  private readonly byTick = new Map<number, TickCommand[]>();
  private readonly fromTick: number;
  private readonly recordingEnd: number;

  /**
   * @param log the recorded commands, ascending in `(applyTick, sequence)` as the queue logged them.
   * @param fromTick the tick the replayed world stands at once built; entries at or before it belong
   *   to the world build the replay re-runs, never to the recording.
   * @param endTick the last tick the recording covers, the capturing session's tick. Ticks without a
   *   command are part of the recording as empty frames; a command past `endTick` is a broken capture.
   */
  constructor(log: readonly LoggedCommand[], fromTick: number, endTick: number) {
    if (!Number.isSafeInteger(fromTick) || fromTick < 0) {
      throw new Error(`ReplayTransport: fromTick must be a non-negative integer, got ${fromTick}`);
    }
    if (!Number.isSafeInteger(endTick) || endTick < fromTick) {
      throw new Error(`ReplayTransport: endTick ${endTick} must be an integer of at least ${fromTick}`);
    }
    this.fromTick = fromTick;
    this.recordingEnd = endTick;
    for (const entry of log) {
      if (entry.applyTick <= fromTick) continue;
      if (entry.applyTick > endTick) {
        throw new Error(
          `ReplayTransport: a command applies at tick ${entry.applyTick}, past the recording's end ${endTick}`,
        );
      }
      const held = this.byTick.get(entry.applyTick);
      const command: TickCommand = { envelope: entry, sequence: entry.sequence };
      if (held === undefined) this.byTick.set(entry.applyTick, [command]);
      else held.push(command);
    }
  }

  /** The last tick the recording covers: the clock stops there, not at the last command. */
  get endTick(): number {
    return this.recordingEnd;
  }

  /** The complete input frame for `tick`, or null past the recording's end. A replayed tick's own
   *  re-emissions are the sim's business, never the transport's: the recording carries every command
   *  the original run applied, so it is the only source a replayed tick admits. */
  take(tick: number): TickFrame | null {
    if (tick <= this.fromTick || tick > this.recordingEnd) return null;
    return { tick, commands: this.byTick.get(tick) ?? [] };
  }

  submit(): void {
    throw new Error('a replay accepts no live commands');
  }
}

export interface ReplayDriverOptions {
  readonly sim: Simulation;
  readonly transport: ReplayTransport;
  /** Wall-clock multiplier the session starts at; default 1. */
  readonly speed?: number;
  readonly paused?: boolean;
}

/**
 * One client of a recorded session: the {@link LockstepDriver} clock over a transport that serves a
 * finished run's input. Each tick discards the replaying sim's own re-emissions first - the recording
 * carries the applied copies verbatim, so a re-emitted command would double-apply - then admits the
 * recorded frame, which restores every command to the tick and sequence it originally took.
 */
export class ReplayDriver implements SessionDriver {
  private readonly sim: Simulation;
  private readonly transport: ReplayTransport;
  private readonly timestep: FixedTimestep;
  private speedMultiplier = 1;
  private pausedFlag: boolean;
  /** Held across frames so a paused or finished replay keeps drawing at the fraction it stopped on. */
  private alpha = 1;
  /** Bound once, so a frame never mints a fresh closure for the timestep. */
  private onTick: (() => void) | undefined;
  private readonly stepTick = (): boolean => {
    if (!this.runTick()) return false;
    this.onTick?.();
    return true;
  };

  constructor(options: ReplayDriverOptions) {
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

  /** The last tick the recording covers. */
  get endTick(): number {
    return this.transport.endTick;
  }

  /** True once the replay has run its last tick; the clock stands paused from there on. */
  get ended(): boolean {
    return this.sim.tick >= this.endTick;
  }

  setPaused(paused: boolean): void {
    if (this.ended && !paused) return;
    this.pausedFlag = paused;
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error(`session speed must be a positive number, got ${speed}`);
    }
    this.speedMultiplier = speed;
  }

  /** A watched state is savable as any world's: no future input accompanies it, for the recording
   *  already decided every command. */
  captureSave(options: ExportSaveOptions = {}): ReturnType<typeof exportSaveGame> {
    return exportSaveGame(this.sim, options);
  }

  /** A replay takes no live commands: its input was recorded, and a new one would diverge every
   *  client of the original run. */
  submit(envelope: unknown): void {
    void envelope;
    this.transport.submit();
  }

  /**
   * Feed elapsed real time and run the ticks it earns, as far as the recording authorizes them.
   * `onTick` runs after each applied tick. Returns the renderer's interpolation alpha, which a paused
   * or finished replay holds where it stood.
   */
  advance(elapsedMs: number, onTick?: () => void): number {
    if (this.pausedFlag) return this.alpha;
    this.onTick = onTick;
    this.alpha = this.timestep.advanceWhile(elapsedMs * this.speedMultiplier, this.stepTick);
    return this.alpha;
  }

  /** Run the next tick if the recording covers it, reporting whether it ran. */
  runTick(): boolean {
    if (this.pausedFlag) return false;
    const tick = this.sim.tick + 1;
    if (tick > this.endTick) {
      this.pausedFlag = true;
      return false;
    }
    const frame = this.transport.take(tick);
    if (frame === null) return false;
    this.sim.commands.discardPending();
    for (const command of frame.commands) this.sim.enqueueAt(command.envelope, tick, command.sequence);
    this.sim.step();
    if (tick === this.endTick) this.pausedFlag = true;
    return true;
  }
}
