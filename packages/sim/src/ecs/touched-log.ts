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
 * current epoch and their slot in that order, so a drain starts a new epoch instead of clearing a set.
 */
export class TouchedLog {
  private order = new Int32Array(INITIAL_CAPACITY);
  private count = 0;
  private stamps = new Int32Array(INITIAL_CAPACITY);
  /** Per dense entity, its index in `order`, valid while its stamp is the current epoch's. */
  private slots = new Int32Array(INITIAL_CAPACITY);
  private readonly sparseStamps = new Map<Entity, number>();
  private readonly sparseSlots = new Map<Entity, number>();
  private epoch = 1;
  /** Per slot, the components its entity wrote this epoch, in first-write order. Every list at or past
   *  `count` is empty, so a newly logged entity reuses its slot's list without clearing it. */
  private readonly written: Component<unknown>[][] = [];
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
      this.overflowed = true;
    }
    const logged = this.epoch << 1;
    const fresh = (this.stampOf(entity) & ~MEMBERSHIP_BIT) !== logged;
    let slot = this.count;
    if (fresh) {
      this.count++;
      if (slot === this.order.length) this.order = grown(this.order, slot + 1);
      this.order[slot] = entity;
      this.stamp(entity, logged, slot);
    }
    if (!this.detailed) return this.mutations;
    if (!fresh) slot = this.slotOf(entity);
    if (component !== undefined) {
      const written = this.listAt(slot);
      if (!written.includes(component)) written.push(component);
    }
    if (membership) this.stamp(entity, logged | MEMBERSHIP_BIT, slot);
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
   * Component lists are borrowed for the callback only; the log clears and reuses them afterward.
   */
  drain(
    consume: (entity: Entity, components: readonly Component<unknown>[], membership: boolean) => void,
  ): boolean {
    const logged = this.epoch << 1;
    const written = this.written;
    for (let slot = 0; slot < this.count; slot++) {
      const e = this.order[slot] as Entity;
      const components = written[slot];
      consume(e, components ?? NO_COMPONENTS, this.stampOf(e) === (logged | MEMBERSHIP_BIT));
      if (components !== undefined) components.length = 0;
    }
    this.count = 0;
    this.forget();
    const overflowed = this.overflowed;
    this.overflowed = false;
    return overflowed;
  }

  /** Empty the log: a new epoch voids every stamp at once. */
  private forget(): void {
    for (let slot = 0; slot < this.count; slot++) {
      const components = this.written[slot];
      if (components !== undefined) components.length = 0;
    }
    this.count = 0;
    this.epoch++;
    this.sparseStamps.clear();
    this.sparseSlots.clear();
  }

  /** The slot's component list; component tracking that began mid-epoch finds none for earlier slots. */
  private listAt(slot: number): Component<unknown>[] {
    const written = this.written;
    while (written.length <= slot) written.push([]);
    return written[slot] as Component<unknown>[];
  }

  private stampOf(entity: Entity): number {
    return entity < this.stamps.length ? (this.stamps[entity] ?? 0) : (this.sparseStamps.get(entity) ?? 0);
  }

  private slotOf(entity: Entity): number {
    return entity < this.slots.length ? (this.slots[entity] ?? 0) : (this.sparseSlots.get(entity) ?? 0);
  }

  private stamp(entity: Entity, value: number, slot: number): void {
    if (entity >= this.stamps.length && entity < DENSE_STAMP_LIMIT) {
      this.stamps = grown(this.stamps, entity + 1);
      this.slots = grown(this.slots, entity + 1);
    }
    if (entity < this.stamps.length) {
      this.stamps[entity] = value;
      this.slots[entity] = slot;
    } else {
      this.sparseStamps.set(entity, value);
      this.sparseSlots.set(entity, slot);
    }
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

const NO_COMPONENTS: readonly Component<unknown>[] = [];
