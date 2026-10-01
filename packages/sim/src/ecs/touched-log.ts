import type { Component, Entity } from './component.js';

/** Log size past which the whole log is dropped rather than grown forever. Only reachable when nothing
 *  drains it (a snapshot-less headless benchmark); one full cache rebuild is the entire cost. */
export const TOUCHED_LOG_OVERFLOW_LIMIT = 65536;

/** Entity ids below this are stamped in a dense array; a higher id (only a crafted save can name one)
 *  falls back to a map, so a hostile id cannot size the array. */
const DENSE_STAMP_LIMIT = 1 << 24;
const INITIAL_CAPACITY = 1024;
/** A stamp is `epoch << 1`, with this bit set once the entity's membership changed in that epoch. */
const MEMBERSHIP_BIT = 1;

/**
 * The entities whose components changed since the last {@link drain}: the invalidation feed for
 * identity-keyed read caches (the snapshot's per-entity clone cache). Read-path only, never consulted by a
 * sim decision, so it cannot affect determinism. Entities are logged in record order and stamped with the
 * current epoch, so a drain starts a new epoch instead of clearing a set.
 */
export class TouchedLog {
  private order = new Int32Array(INITIAL_CAPACITY);
  private count = 0;
  private stamps = new Int32Array(INITIAL_CAPACITY);
  private readonly sparseStamps = new Map<Entity, number>();
  private epoch = 1;
  private readonly components = new Map<Entity, Set<Component<unknown>>>();
  private readonly spareComponents: Set<Component<unknown>>[] = [];
  private detailed = false;
  private mutations = 0;
  private overflowed = false;

  /** Monotonic count of every recorded mutation. Unlike "is the log empty" it cannot be falsified by one
   *  consumer draining the log between another consumer's two staleness probes. */
  get mutationCount(): number {
    return this.mutations;
  }

  /** Start collecting component details before the first snapshot cache is populated. */
  trackComponents(): void {
    this.detailed = true;
  }

  /** Record an entity mutation and return its unique monotonic revision. `membership` marks a write
   *  that added or removed the component rather than changing its value. */
  record(entity: Entity, component?: Component<unknown>, membership = false): number {
    this.mutations++;
    if (this.count >= TOUCHED_LOG_OVERFLOW_LIMIT) {
      this.forget();
      this.spareComponents.length = 0;
      this.overflowed = true;
    }
    const logged = this.epoch << 1;
    const stamp = this.stampOf(entity);
    if ((stamp & ~MEMBERSHIP_BIT) !== logged) {
      if (this.count === this.order.length) this.order = grown(this.order, this.count + 1);
      this.order[this.count++] = entity;
      this.stamp(entity, logged);
    }
    if (!this.detailed) return this.mutations;
    if (component !== undefined) {
      let written = this.components.get(entity);
      if (written === undefined) {
        written = this.spareComponents.pop() ?? new Set();
        this.components.set(entity, written);
      }
      written.add(component);
    }
    if (membership) this.stamp(entity, logged | MEMBERSHIP_BIT);
    return this.mutations;
  }

  /** Whether `entity` has a recorded mutation the next {@link drain} will deliver. After an overflow every
   *  entity counts as pending, since the individual names were lost. */
  pending(entity: Entity): boolean {
    return this.overflowed || (this.stampOf(entity) & ~MEMBERSHIP_BIT) === this.epoch << 1;
  }

  /**
   * Hands every logged entity to `consume` and clears the log. Returns `true` when the log overflowed since
   * the last drain: those individual evictions were lost, so the consumer must discard its entire cache.
   * Component sets are borrowed for the callback only; the log clears and reuses them afterward.
   */
  drain(
    consume: (entity: Entity, components: ReadonlySet<Component<unknown>>, membership: boolean) => void,
  ): boolean {
    const logged = this.epoch << 1;
    for (let i = 0; i < this.count; i++) {
      const e = this.order[i] as Entity;
      consume(e, this.components.get(e) ?? NO_COMPONENTS, this.stampOf(e) === (logged | MEMBERSHIP_BIT));
    }
    for (const written of this.components.values()) {
      written.clear();
      if (this.spareComponents.length < TOUCHED_LOG_OVERFLOW_LIMIT) this.spareComponents.push(written);
    }
    this.forget();
    const overflowed = this.overflowed;
    this.overflowed = false;
    return overflowed;
  }

  /** Empty the log: a new epoch voids every stamp at once. */
  private forget(): void {
    this.count = 0;
    this.epoch++;
    this.sparseStamps.clear();
    this.components.clear();
  }

  private stampOf(entity: Entity): number {
    return entity < this.stamps.length ? (this.stamps[entity] ?? 0) : (this.sparseStamps.get(entity) ?? 0);
  }

  private stamp(entity: Entity, value: number): void {
    if (entity >= this.stamps.length && entity < DENSE_STAMP_LIMIT) {
      this.stamps = grown(this.stamps, entity + 1);
    }
    if (entity < this.stamps.length) this.stamps[entity] = value;
    else this.sparseStamps.set(entity, value);
  }
}

/** `buffer` copied into one at least `needed` long, doubling so growth stays amortized. */
function grown(buffer: Int32Array<ArrayBuffer>, needed: number): Int32Array<ArrayBuffer> {
  let length = buffer.length * 2;
  while (length < needed) length *= 2;
  const next = new Int32Array(length);
  next.set(buffer);
  return next;
}

const NO_COMPONENTS: ReadonlySet<Component<unknown>> = new Set();
