import { type CommandEnvelope, ownedEnvelope } from './commands/envelope.js';

/** A queued input: a queue-owned copy of the caller's envelope, stamped with the queue's sequence. */
export type QueuedCommand = CommandEnvelope & { readonly sequence: number };

/**
 * A queued input stamped with the tick it was applied on. This is the unit of the replay log and a
 * candidate future lockstep input. `(applyTick, sequence)` is the log's total order, so commands from
 * different origins sharing a tick stay explicitly ordered. It is not a persisted save format; long
 * sessions also need restorable state.
 */
export type LoggedCommand = QueuedCommand & { readonly applyTick: number };

/**
 * The command queue is the single external mutation seam into the sim. Player, UI, AI and replay code
 * {@link enqueue} an authorized {@link CommandEnvelope}; systems own internal world updates. Each tick
 * CommandSystem {@link drain}s the pending commands in FIFO enqueue order, admits the ones the origin
 * is entitled to, and appends every one to the {@link log}. The queue is a plain array, so apply order
 * is exactly enqueue order and two runs that enqueue the same commands on the same ticks produce
 * byte-identical state.
 */
export class CommandQueue {
  private pending: QueuedCommand[] = [];
  private readonly applied: LoggedCommand[] = [];
  private nextSequence = 0;
  /** {@link nextSequence} when the current pending batch opened, so {@link discardPending} gives the
   *  numbers back and a replayed log carries the sequences its live run recorded. */
  private pendingBase = 0;

  /** Copy `envelope` into the queue and give it the next sequence, to be applied on the next tick's
   *  CommandSystem pass. */
  enqueue(envelope: CommandEnvelope): void {
    this.pending.push({ ...ownedEnvelope(envelope), sequence: this.nextSequence++ });
  }

  /** Number of commands waiting to be applied (not yet drained). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Take and clear the pending commands. Returns them in enqueue order; CommandSystem (the one
   * per-tick caller) records each applied command via {@link record}.
   */
  drain(): readonly QueuedCommand[] {
    const out = this.pending;
    this.pending = [];
    this.pendingBase = this.nextSequence;
    return out;
  }

  /**
   * Throw away the pending commands without applying them - replay reconstruction's seam (see
   * `stepReplaying`): a replaying sim's own systems (the AI player) re-emit their commands live, but
   * the log already carries the applied copies verbatim, so the re-emissions must be discarded or
   * every sim-emitted command would double-apply.
   */
  discardPending(): void {
    this.pending = [];
    this.nextSequence = this.pendingBase;
  }

  /** Append an applied command to the log (CommandSystem-only, after it admits or rejects it). */
  record(applyTick: number, queued: QueuedCommand): void {
    this.applied.push({ ...queued, applyTick });
  }

  /** The append-only replay log, strictly ascending in `(applyTick, sequence)`. Read-only to consumers. */
  get log(): readonly LoggedCommand[] {
    return this.applied;
  }
}
