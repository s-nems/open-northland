import type { TickBatch, TickRecord } from './protocol.js';

export interface TickOutboxLink {
  /** The records as one batch, its delta taken now. `leadTicks` is the most ticks left undelivered
   *  at any step the batch carries. */
  take(records: TickRecord[], leadTicks: number): TickBatch;
  post(batch: TickBatch): void;
  /** The undelivered ticks the clock may run to now. */
  limit(): number;
}

/**
 * The stepped ticks the runtime has not delivered yet: the batch posted and not yet delivered, and the
 * ticks stepped since. One batch is in flight at a time and the next spans every tick stepped
 * meanwhile, so the runtime takes in one delta per drawn frame however many ticks the frame shows: a
 * delta's cost barely depends on the ticks it spans. At the limit the clock stops until the runtime
 * delivers.
 */
export class TickOutbox {
  /** Stepped ticks no batch carries yet. */
  private pending: TickRecord[] = [];
  /** The ticks of the batch posted and not yet delivered; 0 when none is in flight. */
  private inFlightTicks = 0;
  private peakUndelivered = 0;
  private abandoned = false;

  constructor(private readonly link: TickOutboxLink) {}

  /** Whether a tick recorded now is posted at once, so its live event list may go uncloned. */
  postsNow(): boolean {
    return this.inFlightTicks === 0;
  }

  mayStep(): boolean {
    return this.undeliveredTicks() < this.link.limit();
  }

  add(record: TickRecord): void {
    this.pending.push(record);
    this.peakUndelivered = Math.max(this.peakUndelivered, this.undeliveredTicks());
    if (this.postsNow()) this.flush();
  }

  /** The runtime delivered this many more batches: post what was stepped meanwhile. Returns the ticks
   *  the delivered batch carried. */
  delivered(batches: number): number {
    const ticks = batches > 0 ? this.inFlightTicks : 0;
    if (batches > 0) this.inFlightTicks = 0;
    if (this.postsNow()) this.flush();
    return ticks;
  }

  /** A tick failed: nothing more is posted, and the ticks no batch carries yet are dropped. */
  abandon(): void {
    this.abandoned = true;
    this.pending = [];
  }

  private undeliveredTicks(): number {
    return this.inFlightTicks + this.pending.length;
  }

  private flush(): void {
    const records = this.pending;
    if (records.length === 0 || this.abandoned) return;
    this.pending = [];
    const batch = this.link.take(records, this.peakUndelivered);
    this.peakUndelivered = 0;
    this.inFlightTicks = records.length;
    this.link.post(batch);
  }
}
