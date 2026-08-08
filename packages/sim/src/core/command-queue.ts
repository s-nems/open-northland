import { type CommandEnvelope, ownedEnvelope } from './commands/envelope.js';

/**
 * An applied command: the queue's own copy of the caller's envelope, plus where it sits in the run.
 * This is the unit of the replay log and a candidate future lockstep input. `(applyTick, sequence)` is
 * the log's total order, so commands from different origins sharing a tick stay explicitly ordered, and
 * a replay of the log reproduces both numbers. It is not a persisted save format; long sessions also
 * need restorable state.
 */
export type LoggedCommand = CommandEnvelope & {
  readonly applyTick: number;
  readonly sequence: number;
};

/**
 * The command queue is the single external mutation seam into the sim. Player, UI, AI and replay code
 * {@link enqueue} an authorized {@link CommandEnvelope}; systems own internal world updates. Each tick
 * CommandSystem {@link drain}s the pending commands in FIFO enqueue order, admits the ones the origin
 * is entitled to, and {@link record}s every one. The queue is a plain array, so apply order is exactly
 * enqueue order and two runs that enqueue the same commands on the same ticks produce byte-identical
 * state.
 */
export class CommandQueue {
  private pending: CommandEnvelope[] = [];
  private readonly applied: LoggedCommand[] = [];
  private nextSequence = 0;

  /** Copy `envelope` into the queue, to be applied on the next tick's CommandSystem pass. */
  enqueue(envelope: CommandEnvelope): void {
    this.pending.push(ownedEnvelope(envelope));
  }

  /** Number of commands waiting to be applied (not yet drained). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Take and clear the pending commands. Returns them in enqueue order; CommandSystem (the one
   * per-tick caller) records each one via {@link record}.
   */
  drain(): readonly CommandEnvelope[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /**
   * Throw away the pending commands without applying them - replay reconstruction's seam (see
   * `stepReplaying`): a replaying sim's own systems (the AI player) re-emit their commands live, but
   * the log already carries the applied copies verbatim, so the re-emissions must be discarded or
   * every sim-emitted command would double-apply. A discarded command never happened, so it takes no
   * sequence and a replayed log stays numbered like the run it reconstructs.
   */
  discardPending(): void {
    this.pending = [];
  }

  /** Append a command to the log and give it the run's next sequence (CommandSystem-only, after it
   *  admits or rejects it). */
  record(applyTick: number, envelope: CommandEnvelope): void {
    this.applied.push({ ...envelope, applyTick, sequence: this.nextSequence++ });
  }

  /** The append-only replay log, strictly ascending in `(applyTick, sequence)`. Read-only to consumers. */
  get log(): readonly LoggedCommand[] {
    return this.applied;
  }
}
