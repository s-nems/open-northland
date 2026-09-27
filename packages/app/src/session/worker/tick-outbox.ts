import type { SimEvent } from '@open-northland/sim';
import type { TickBatch, TickRecord, UndeliveredTicks } from './protocol.js';

export interface TickOutboxLink {
  /** The records as one batch, its delta taken now. `leadTicks` is the most ticks left undelivered
   *  at any step the batch carries. */
  take(records: TickRecord[], shedTicks: number, leadTicks: number): TickBatch;
  post(batch: TickBatch): void;
  /** The undelivered ticks the policy allows now. */
  limit(): number;
}

/**
 * The stepped ticks the runtime has not delivered yet: the batch posted and not yet delivered, and the
 * ticks stepped since. One batch is in flight at a time and the next spans every tick stepped
 * meanwhile, so the runtime takes in one delta per drawn frame however many ticks the frame shows: a
 * delta's cost barely depends on the ticks it spans.
 */
export class TickOutbox {
  /** Stepped ticks no batch carries yet. */
  private pending: TickRecord[] = [];
  /** The ticks of the batch posted and not yet delivered; 0 when none is in flight. */
  private inFlightTicks = 0;
  private shedTicks = 0;
  private peakUndelivered = 0;
  /** The retained events of the ticks shed since the last batch, in order; the next batch's first
   *  record carries them. Only the retained kinds, world changes a presentation keeps and a few per
   *  tick, so a long episode holds its world changes and none of its transient events. */
  private carried: SimEvent[] = [];
  private abandoned = false;

  constructor(
    private readonly policy: UndeliveredTicks,
    private readonly link: TickOutboxLink,
    private readonly retained: ReadonlySet<SimEvent['kind']>,
  ) {}

  /** Whether a tick recorded now is posted at once, so its live event list may go uncloned. */
  postsNow(): boolean {
    return this.inFlightTicks === 0;
  }

  /** A holding outbox stops the clock at its limit; a shedding one never does. */
  mayStep(): boolean {
    return this.policy === 'shed' || this.undeliveredTicks() < this.link.limit();
  }

  add(record: TickRecord): void {
    this.pending.push(record);
    const postNow = this.postsNow();
    if (!postNow && this.policy === 'shed') this.shed();
    this.peakUndelivered = Math.max(this.peakUndelivered, this.undeliveredTicks());
    if (postNow) this.flush();
  }

  /** The runtime delivered this many more batches: post what was stepped meanwhile. */
  delivered(batches: number): void {
    if (batches > 0) this.inFlightTicks = 0;
    if (this.postsNow()) this.flush();
  }

  /** A tick failed: nothing more is posted, and the ticks no batch carries yet are dropped. */
  abandon(): void {
    this.abandoned = true;
    this.pending = [];
    this.carried = [];
  }

  /**
   * Only records still in this outbox are shed: a posted batch is the runtime's, so the undelivered
   * count stays within the limit plus what the batch in flight carries. The newest record is always
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

  private undeliveredTicks(): number {
    return this.inFlightTicks + this.pending.length;
  }

  private flush(): void {
    const records = this.pending;
    if (records.length === 0 || this.abandoned) return;
    this.pending = [];
    const first = records[0];
    if (this.carried.length > 0 && first !== undefined) {
      records[0] = { ...first, events: [...this.carried, ...first.events] };
      this.carried = [];
    }
    const batch = this.link.take(records, this.shedTicks, this.peakUndelivered);
    this.shedTicks = 0;
    this.peakUndelivered = 0;
    this.inFlightTicks = records.length;
    this.link.post(batch);
  }
}
