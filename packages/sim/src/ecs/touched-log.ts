import type { Entity } from './component.js';

/** Log size past which the whole log is dropped rather than grown forever. Only reachable when nothing
 *  drains it (a snapshot-less headless benchmark); one full cache rebuild is the entire cost. */
export const TOUCHED_LOG_OVERFLOW_LIMIT = 65536;

/**
 * The entities whose components changed since the last {@link drain}: the invalidation feed for
 * identity-keyed read caches (the snapshot's per-entity clone cache). Read-path only, never consulted by a
 * sim decision, so it cannot affect determinism.
 */
export class TouchedLog {
  private readonly entities = new Set<Entity>();
  private mutations = 0;
  private overflowed = false;

  /** Monotonic count of every recorded mutation. Unlike "is the log empty" it cannot be falsified by one
   *  consumer draining the log between another consumer's two staleness probes. */
  get mutationCount(): number {
    return this.mutations;
  }

  /** Record an entity mutation and return its unique monotonic revision. */
  record(entity: Entity): number {
    this.mutations++;
    if (this.entities.size >= TOUCHED_LOG_OVERFLOW_LIMIT) {
      this.entities.clear();
      this.overflowed = true;
    }
    this.entities.add(entity);
    return this.mutations;
  }

  /** Whether `entity` has a recorded mutation the next {@link drain} will deliver. After an overflow every
   *  entity counts as pending, since the individual names were lost. */
  pending(entity: Entity): boolean {
    return this.overflowed || this.entities.has(entity);
  }

  /**
   * Hands every logged entity to `consume` and clears the log. Returns `true` when the log overflowed since
   * the last drain: those individual evictions were lost, so the consumer must discard its entire cache.
   */
  drain(consume: (entity: Entity) => void): boolean {
    for (const e of this.entities) consume(e);
    this.entities.clear();
    const overflowed = this.overflowed;
    this.overflowed = false;
    return overflowed;
  }
}
