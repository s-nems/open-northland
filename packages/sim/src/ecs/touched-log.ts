import type { Component, Entity } from './component.js';

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
  private readonly components = new Map<Entity, Set<Component<unknown>>>();
  private readonly memberships = new Set<Entity>();
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
    if (this.entities.size >= TOUCHED_LOG_OVERFLOW_LIMIT) {
      this.entities.clear();
      this.components.clear();
      this.memberships.clear();
      this.spareComponents.length = 0;
      this.overflowed = true;
    }
    this.entities.add(entity);
    if (!this.detailed) return this.mutations;
    if (component !== undefined) {
      let written = this.components.get(entity);
      if (written === undefined) {
        written = this.spareComponents.pop() ?? new Set();
        this.components.set(entity, written);
      }
      written.add(component);
    }
    if (membership) this.memberships.add(entity);
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
   * Component sets are borrowed for the callback only; the log clears and reuses them afterward.
   */
  drain(
    consume: (entity: Entity, components: ReadonlySet<Component<unknown>>, membership: boolean) => void,
  ): boolean {
    for (const e of this.entities)
      consume(e, this.components.get(e) ?? NO_COMPONENTS, this.memberships.has(e));
    for (const written of this.components.values()) {
      written.clear();
      if (this.spareComponents.length < TOUCHED_LOG_OVERFLOW_LIMIT) this.spareComponents.push(written);
    }
    this.entities.clear();
    this.components.clear();
    this.memberships.clear();
    const overflowed = this.overflowed;
    this.overflowed = false;
    return overflowed;
  }
}

const NO_COMPONENTS: ReadonlySet<Component<unknown>> = new Set();
