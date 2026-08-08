import { type CommandEnvelope, ownedEnvelope } from './commands/envelope.js';

/**
 * An applied command: the queue's own copy of the caller's envelope, plus where it sits in the run.
 * `(applyTick, sequence)` is the replay log's total order, so commands from different origins sharing a
 * tick stay explicitly ordered, and a replay of the log reproduces both numbers. Not a persisted save
 * format.
 */
export type LoggedCommand = CommandEnvelope & {
  readonly applyTick: number;
  readonly sequence: number;
};

/**
 * The single external mutation seam into the sim: callers {@link enqueue} an authorized
 * {@link CommandEnvelope}, and each tick CommandSystem {@link drain}s the pending commands in FIFO
 * enqueue order, admits the ones the origin is entitled to, and {@link record}s every one. Apply order
 * is exactly enqueue order, so two runs that enqueue the same commands on the same ticks produce
 * byte-identical state.
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
   * `stepReplaying`): a replaying sim's own systems re-emit their commands live, but the log already
   * carries the applied copies verbatim, so the re-emissions must be discarded or every sim-emitted
   * command would double-apply. A discarded command takes no sequence, so a replayed log stays numbered
   * like the run it reconstructs.
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
