import { type CommandEnvelope, ownedEnvelope } from './commands/envelope.js';
import { parseContinuation, type SavedCommand } from './continuation.js';

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

/** Logged commands per sealed chunk of the replay log. */
const LOG_CHUNK_ENTRIES = 256;

/** An envelope held for the tick it was stamped for, ordered within that tick by `sequence`. */
interface ScheduledEnvelope {
  readonly envelope: CommandEnvelope;
  readonly applyTick: number;
  readonly sequence: number;
}

/**
 * The single external mutation seam into the sim. Callers {@link enqueue} an authorized
 * {@link CommandEnvelope} for the next tick, or {@link enqueueAt} one for a named tick and position
 * within it; each tick CommandSystem {@link drain}s what is due, admits the ones the origin is entitled
 * to, and {@link record}s every one.
 */
export class CommandQueue {
  private pending: CommandEnvelope[] = [];
  private scheduled: ScheduledEnvelope[] = [];
  private continuation: SavedCommand[] = [];
  /** The replay log as JSON text: whole chunks of {@link LOG_CHUNK_ENTRIES} entries, each one array
   *  text, then the entries of the open chunk. A long session logs thousands of commands an hour and
   *  nothing in the run reads them back, so they are held as a few strings rather than as objects
   *  every collection walks. */
  private readonly sealedLog: string[] = [];
  private openLog: string[] = [];
  private nextSequence = 0;
  private late = 0;
  /** Target tick → the sequences already claimed for it, dropped once that tick drains. */
  private readonly claims = new Map<number, Set<number>>();

  /** Copy `envelope` into the queue, to be applied on the next tick's CommandSystem pass. */
  enqueue(envelope: CommandEnvelope): void {
    this.pending.push(ownedEnvelope(envelope));
  }

  /**
   * Copy `envelope` into the queue for tick `applyTick`, ordered within that tick by `sequence`. Both
   * are assigned outside the sim, so the caller owns their uniqueness: two envelopes claiming one
   * position have no agreed order, and taking arrival order instead would differ between two clients of
   * the same session. A second claim on a position throws here, before the queue holds anything.
   */
  enqueueAt(envelope: CommandEnvelope, applyTick: number, sequence: number): void {
    if (!Number.isSafeInteger(applyTick) || applyTick < 0) {
      throw new Error(`enqueueAt: applyTick must be a non-negative integer, got ${applyTick}`);
    }
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error(`enqueueAt: sequence must be a non-negative integer, got ${sequence}`);
    }
    const owned = ownedEnvelope(envelope);
    let claimed = this.claims.get(applyTick);
    if (claimed === undefined) {
      claimed = new Set<number>();
      this.claims.set(applyTick, claimed);
    }
    if (claimed.has(sequence)) {
      throw new Error(`two commands claim tick ${applyTick} sequence ${sequence}`);
    }
    claimed.add(sequence);
    this.scheduled.push({ envelope: owned, applyTick, sequence });
  }

  /** Number of untargeted commands waiting to be applied (not yet drained). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Number of targeted commands still held for a tick that has not come yet. */
  get scheduledCount(): number {
    return this.scheduled.length;
  }

  /** Envelopes dropped because their tick had already passed. */
  get lateDrops(): number {
    return this.late;
  }

  /**
   * Take the commands due at `tick` and clear them from the queue: the untargeted ones in enqueue order
   * first - the world's own emissions and authored setup, which belong to the tick's starting state -
   * then inherited save continuation, then fresh commands stamped for this tick in assigned order.
   * A stamp for a later tick stays; one for a tick that has already passed is dropped and counted, never applied late and never logged, so the log
   * stays a record of what this run acted on and replays back to the same state. CommandSystem is the one
   * per-tick caller and records each returned envelope via {@link record}.
   */
  drain(tick: number): readonly CommandEnvelope[] {
    const out = this.pending;
    this.pending = [];
    if (this.continuation.length > 0) {
      const held: SavedCommand[] = [];
      for (const entry of this.continuation) {
        if (entry.applyTick > tick) held.push(entry);
        else if (entry.applyTick < tick) this.late++;
        else out.push(entry.envelope);
      }
      this.continuation = held;
    }
    if (this.scheduled.length > 0) out.push(...this.dueScheduled(tick));
    return out;
  }

  private dueScheduled(tick: number): CommandEnvelope[] {
    const due: ScheduledEnvelope[] = [];
    const held: ScheduledEnvelope[] = [];
    for (const entry of this.scheduled) {
      if (entry.applyTick > tick) held.push(entry);
      else if (entry.applyTick < tick) this.late++;
      else due.push(entry);
    }
    this.scheduled = held;
    for (const claimed of this.claims.keys()) {
      if (claimed <= tick) this.claims.delete(claimed);
    }
    due.sort((a, b) => a.sequence - b.sequence);
    return due.map((entry) => entry.envelope);
  }

  /** The not-yet-drained untargeted envelopes in enqueue order, as detached copies. Targeted ones stay
   *  out: a save carries the tick it was taken at, and the session's own command stream for the ticks
   *  after it reconstructs what was in flight. */
  pendingSnapshot(): CommandEnvelope[] {
    return this.pending.map(ownedEnvelope);
  }

  /** Before adoption, a new session applies its setup before inherited inputs, dropping only those
   *  its rules supersede. Surviving inputs retain their order and assigned ticks. */
  prepareResume(setup: readonly CommandEnvelope[], superseded: (envelope: CommandEnvelope) => boolean): void {
    this.pending = [...setup.map(ownedEnvelope), ...this.pending.filter((envelope) => !superseded(envelope))];
    this.continuation = this.continuation.filter(({ envelope }) => !superseded(envelope));
  }

  /** Detached inherited commands, without claims on the new transport's sequence space. */
  continuationSnapshot(): SavedCommand[] {
    return this.continuation.map(({ applyTick, envelope }) => ({
      applyTick,
      envelope: ownedEnvelope(envelope),
    }));
  }

  /** The sequence the next {@link record} assigns; restoring it keeps a resumed log numbered like the
   *  uninterrupted run. */
  get nextSequenceNumber(): number {
    return this.nextSequence;
  }

  /** Restore seam: adopt a saved queue position - the pending envelopes (as owned copies) and the
   *  next sequence and inherited continuation. Only valid on a queue nothing has touched. */
  restore(
    pending: readonly CommandEnvelope[],
    nextSequence: number,
    continuation: readonly SavedCommand[] = [],
    tick = 0,
  ): void {
    if (
      this.pending.length > 0 ||
      this.scheduled.length > 0 ||
      this.continuation.length > 0 ||
      this.sealedLog.length > 0 ||
      this.openLog.length > 0 ||
      this.nextSequence !== 0
    ) {
      throw new Error('CommandQueue.restore: the queue is already in use');
    }
    const carried = parseContinuation(continuation, tick);
    this.pending = pending.map(ownedEnvelope);
    this.continuation = carried;
    this.nextSequence = nextSequence;
  }

  /**
   * Throw away every command not yet applied, targeted or not - replay reconstruction's seam (see
   * `stepReplaying`): a replaying sim's own systems re-emit their commands live, but the log already
   * carries the applied copies verbatim, so the re-emissions must be discarded or every sim-emitted
   * command would double-apply. A discarded command takes no sequence, so a replayed log stays numbered
   * like the run it reconstructs.
   */
  discardPending(): void {
    this.pending = [];
    this.scheduled = [];
    this.continuation = [];
    this.claims.clear();
  }

  /** Append a command to the log and give it the run's next sequence (CommandSystem-only, after it
   *  admits or rejects it). The envelope's payload went through `ownedEnvelope`, which keeps only what JSON
   *  keeps, so the text decodes to an equal entry. */
  record(applyTick: number, envelope: CommandEnvelope): void {
    const entry: LoggedCommand = { ...envelope, applyTick, sequence: this.nextSequence++ };
    this.openLog.push(JSON.stringify(entry));
    if (this.openLog.length === LOG_CHUNK_ENTRIES) {
      this.sealedLog.push(`[${this.openLog.join(',')}]`);
      this.openLog = [];
    }
  }

  /** The append-only replay log, strictly ascending in `(applyTick, sequence)`, decoded afresh on every
   *  read: a diagnostics or replay seam, never a per-tick one. */
  get log(): readonly LoggedCommand[] {
    // The text is this queue's own serialization of logged entries, not untrusted input.
    const out: LoggedCommand[] = [];
    for (const chunk of this.sealedLog) {
      for (const entry of JSON.parse(chunk) as LoggedCommand[]) out.push(entry);
    }
    for (const text of this.openLog) out.push(JSON.parse(text) as LoggedCommand);
    return out;
  }

  /** The replay log as the text of one JSON array, decoded-free: the sealed chunks' entries and the
   *  open chunk's joined in recording order. A replay capture persists the whole log, and holding the
   *  entries as strings lets it cross as text instead of materializing every command as an object. */
  logText(): string {
    const entries = this.sealedLog.map((chunk) => chunk.slice(1, -1));
    if (this.openLog.length > 0) entries.push(this.openLog.join(','));
    return `[${entries.join(',')}]`;
  }
}
