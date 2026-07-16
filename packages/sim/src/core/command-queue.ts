import type { Command } from './commands/index.js';

/**
 * A command stamped with the tick it is applied on. This is the unit of the **command log** — the
 * append-only record that IS the save format (replay the log from seed 0 to reach any state) and the
 * lockstep-multiplayer wire format (peers exchange `LoggedCommand`s, apply them on the same tick).
 * The log is built from tick 1 even before there's a disk format: the invariant ("the only way state
 * mutates is an applied command") is what matters now, not where the bytes land.
 */
export interface LoggedCommand {
  /** The tick on which CommandSystem applied this command (`Simulation.tick` at apply time). */
  readonly tick: number;
  readonly command: Command;
}

/**
 * The command queue — the single mutation seam into the sim. Player/UI/AI code (and a replaying save
 * loader) call {@link enqueue}; nothing else touches world state directly. Each tick CommandSystem
 * {@link drain}s the pending commands (in FIFO enqueue order — deterministic, no Map/Set iteration)
 * and applies them, appending each to the {@link log}. Determinism: the queue is a plain array, so
 * apply order is exactly enqueue order; two runs that enqueue the same commands on the same ticks
 * produce byte-identical state.
 */
export class CommandQueue {
  private pending: Command[] = [];
  private readonly applied: LoggedCommand[] = [];

  /** Queue a command to be applied on the next tick's CommandSystem pass. */
  enqueue(command: Command): void {
    this.pending.push(command);
  }

  /** Number of commands waiting to be applied (not yet drained). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Take and clear the pending commands. Returns them in enqueue order; CommandSystem (the one
   * per-tick caller) records each applied command via {@link record}. The other sanctioned caller is
   * replay reconstruction: a rebuilt world discards its duplicate setup enqueues before a log replay
   * supplies every command verbatim (see `stepReplaying`).
   */
  drain(): readonly Command[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Append an applied command to the log (CommandSystem-only, after it applies the command). */
  record(tick: number, command: Command): void {
    this.applied.push({ tick, command });
  }

  /** The append-only command log — the save / replay / lockstep record. Read-only to consumers. */
  get log(): readonly LoggedCommand[] {
    return this.applied;
  }
}
