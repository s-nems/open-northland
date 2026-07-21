import type { Command } from './commands/index.js';

/**
 * A command stamped with the tick it is applied on. This is the unit of the replay log and a candidate
 * future lockstep input. It is not a persisted save format; long sessions also need restorable state.
 */
export interface LoggedCommand {
  /** The tick on which CommandSystem applied this command (`Simulation.tick` at apply time). */
  readonly tick: number;
  readonly command: Command;
}

/**
 * The command queue is the single external mutation seam into the sim. Player/UI/AI and replay code call
 * {@link enqueue}; systems own internal world updates. Each tick CommandSystem {@link drain}s the pending
 * commands (in FIFO enqueue order, with no Map/Set iteration)
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
   * per-tick caller) records each applied command via {@link record}.
   */
  drain(): readonly Command[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /**
   * Throw away the pending commands without applying them — replay reconstruction's seam (see
   * `stepReplaying`): a replaying sim's own systems (the AI player) re-emit their commands live, but
   * the log already carries the applied copies verbatim, so the re-emissions must be discarded or
   * every sim-emitted command would double-apply.
   */
  discardPending(): void {
    this.pending = [];
  }

  /** Append an applied command to the log (CommandSystem-only, after it applies the command). */
  record(tick: number, command: Command): void {
    this.applied.push({ tick, command });
  }

  /** The append-only replay log. Read-only to consumers. */
  get log(): readonly LoggedCommand[] {
    return this.applied;
  }
}
