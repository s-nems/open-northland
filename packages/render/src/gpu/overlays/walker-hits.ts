import type { WorldSnapshot } from '@open-northland/sim';
import type { DrawnWalker } from '../sprite-pool/index.js';

/** A drawn walker the read picked, with what it read. */
export interface WalkerHit<T> {
  readonly ref: number;
  readonly value: T;
}

/**
 * The drawn walkers a snapshot read picks, in draw-list order. The read depends on the snapshot alone,
 * so it runs again for a new snapshot or a new drawn list, which the pool never refills in place, and
 * the frames in between walk only the hits.
 */
export class WalkerHits<T> {
  private snapshot: WorldSnapshot | undefined;
  private walkers: readonly DrawnWalker[] | undefined;
  private readonly hits: WalkerHit<T>[] = [];

  /** `read` answers undefined for a walker it does not pick. */
  constructor(private readonly read: (snapshot: WorldSnapshot, ref: number) => T | undefined) {}

  of(snapshot: WorldSnapshot, walkers: readonly DrawnWalker[]): readonly WalkerHit<T>[] {
    if (snapshot === this.snapshot && walkers === this.walkers) return this.hits;
    this.snapshot = snapshot;
    this.walkers = walkers;
    this.hits.length = 0;
    for (const walker of walkers) {
      const value = this.read(snapshot, walker.ref);
      if (value !== undefined) this.hits.push({ ref: walker.ref, value });
    }
    return this.hits;
  }

  /** The read itself changed: the next {@link of} reads every walker again. */
  forget(): void {
    this.snapshot = undefined;
    this.walkers = undefined;
  }
}
