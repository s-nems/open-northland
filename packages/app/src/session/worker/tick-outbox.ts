import type { SimEvent } from '@open-northland/sim';
import type { TickBatch, TickRecord, UndeliveredTicks } from './protocol.js';

/**
 * Tick batches posted and not yet delivered past which the worker keeps stepping but holds its ticks
 * back, so the next batch spans them. Two lets one batch wait in the runtime's queue while the next is
 * already on its way.
 */
export const TICK_BATCHES_IN_FLIGHT = 2;

export interface TickOutboxLink {
  /** The records as one batch, its delta taken now. */
  take(records: TickRecord[], shedTicks: number): TickBatch;
  post(batch: TickBatch): void;
  /** The undelivered ticks the policy allows at the session's current speed. */
  limit(): number;
}

/** The stepped ticks the runtime has not delivered yet: posted, held back, or not yet in a batch. */
export class TickOutbox {
  /** Stepped ticks no batch carries yet. */
  private pending: TickRecord[] = [];
  /** Batches taken while the runtime had no room, oldest first: each spans at most
   *  `maxTicksPerBatch` ticks, so the runtime can deliver them a frame's worth at a time. A shedding
   *  outbox holds none, since a shed record's batch would still owe its delta. */
  private readonly held: TickBatch[] = [];
  /** Per batch posted and not yet delivered, its tick count, oldest first. */
  private readonly inFlight: number[] = [];
  private inFlightTicks = 0;
  private shedTicks = 0;
  /** The retained events of the ticks shed since the last batch, in order; the next batch's first
   *  record carries them. Only the retained kinds, world changes a presentation keeps and a few per
   *  tick, so a long episode holds its world changes and none of its transient events. */
  private carried: SimEvent[] = [];

  constructor(
    private readonly policy: UndeliveredTicks,
    private readonly maxTicksPerBatch: number,
    private readonly link: TickOutboxLink,
    private readonly retained: ReadonlySet<SimEvent['kind']>,
  ) {}

  /** Whether a tick recorded now is posted at once, so its live event list may go uncloned. */
  postsNow(): boolean {
    return this.hasRoom() && this.held.length === 0;
  }

  /** A holding outbox stops the clock at its limit; a shedding one never does. */
  mayStep(): boolean {
    return this.policy === 'shed' || this.undeliveredTicks() < this.link.limit();
  }

  add(record: TickRecord): void {
    const postNow = this.postsNow();
    this.pending.push(record);
    if (postNow) this.flush();
    else if (this.policy === 'shed') this.shed();
    else if (this.pending.length >= this.maxTicksPerBatch) this.held.push(this.takePending());
  }

  /** The runtime delivered this many more batches: post what now has room. */
  delivered(batches: number): void {
    for (let i = 0; i < batches; i++) this.inFlightTicks -= this.inFlight.shift() ?? 0;
    while (this.hasRoom() && (this.held.length > 0 || this.pending.length > 0)) this.flush();
  }

  /** Post everything regardless of room: the ticks before a failing one are the runtime's to deliver. */
  flushAll(): void {
    while (this.held.length > 0 || this.pending.length > 0) this.flush();
  }

  /**
   * Only records still in this outbox are shed: a posted batch is the runtime's, so the undelivered
   * count stays within the limit plus what the batches in flight carry. The newest record is always
   * kept, so the next batch's delta reaches the last stepped tick even if the clock stops here.
   */
  private shed(): void {
    const limit = this.link.limit();
    while (this.pending.length > 1 && this.inFlightTicks + this.pending.length > limit) {
      const record = this.pending.shift();
      this.shedTicks++;
      for (const event of record?.events ?? []) if (this.retained.has(event.kind)) this.carried.push(event);
    }
  }

  private hasRoom(): boolean {
    return this.inFlight.length < TICK_BATCHES_IN_FLIGHT;
  }

  private undeliveredTicks(): number {
    let ticks = this.inFlightTicks + this.pending.length;
    for (const batch of this.held) ticks += batch.ticks.length;
    return ticks;
  }

  /** Post the oldest held batch, or one over the pending ticks. */
  private flush(): void {
    const batch = this.held.shift() ?? (this.pending.length > 0 ? this.takePending() : null);
    if (batch === null) return;
    this.inFlight.push(batch.ticks.length);
    this.inFlightTicks += batch.ticks.length;
    this.link.post(batch);
  }

  private takePending(): TickBatch {
    const records = this.pending;
    this.pending = [];
    const first = records[0];
    if (this.carried.length > 0 && first !== undefined) {
      records[0] = { ...first, events: [...this.carried, ...first.events] };
      this.carried = [];
    }
    const batch = this.link.take(records, this.shedTicks);
    this.shedTicks = 0;
    return batch;
  }
}
