/**
 * A tiny, explicit ECS. Deliberately not a library: iteration order is a determinism contract here (see
 * docs/ECS.md). Entity ids come from a monotonic counter and are never recycled, because id reuse would make
 * iteration order history-dependent.
 */

import type { Component, DeepReadonly, Entity } from './component.js';
import { MembershipJournals } from './membership-journal.js';
import { QueryIterator } from './query-iterator.js';
import { TouchedLog } from './touched-log.js';

export type { Component, DeepReadonly, Entity } from './component.js';
export { defineComponent } from './component.js';

/** Re-derives one incrementally-maintained cache from authoritative state and returns a message per
 *  mismatch (empty = coherent). Must be pure over current state. */
export type CacheVerifier = () => string[];

export class World {
  private nextId = 1;
  private readonly alive = new Set<Entity>();
  /** The per-component entity→value stores, created on first {@link add}. Each store's insertion order is the
   *  query iteration order. */
  private readonly stores = new Map<Component<unknown>, Map<Entity, unknown>>();
  /** Components in first-registration order: stable, used for canonical hashing/snapshots. */
  private readonly registered: Array<Component<unknown>> = [];
  /** Each component's index into {@link registered}, assigned on first {@link add}. */
  private readonly registrationIndex = new Map<Component<unknown>, number>();
  /** Per-entity carried components as ascending registration indices, so a component walk visits the
   *  entity's own components in registration order instead of probing every registered store. */
  private readonly memberships = new Map<Entity, number[]>();
  /** Per-component membership (add/remove/destroy) generation, used by derived caches that depend on a
   *  component store. */
  private readonly componentGenerations = new Map<Component<unknown>, number>();
  /** Per-component in-place value-write generation (see {@link mut}), separate from the membership
   *  generations above so spatial indexes keyed on add/remove stay unaffected. */
  private readonly componentValueGenerations = new Map<Component<unknown>, number>();
  private readonly journals = new MembershipJournals();
  private readonly touched = new TouchedLog();
  /** Derived-cache verifiers by name, run in first-registration order; registering a name again replaces the
   *  verifier but keeps its position. */
  private readonly cacheVerifiers = new Map<string, CacheVerifier>();
  /** Memoized ascending-id list from {@link canonicalEntities}, invalidated only by {@link create} and
   *  {@link destroy} since component add/remove cannot change the alive set. */
  private canonicalCache: readonly Entity[] | null = null;

  create(): Entity {
    const id = this.nextId++ as Entity;
    this.alive.add(id);
    this.canonicalCache = null;
    // A snapshot emits one entry per alive id, so even a component-less `create` must bump the version, or
    // the per-tick memo serves a view missing the new entity.
    this.touched.record(id);
    return id;
  }

  destroy(entity: Entity): void {
    const carried = this.memberships.get(entity);
    if (carried !== undefined) {
      for (const index of carried) {
        const c = this.registered[index];
        if (c !== undefined && this.stores.get(c)?.delete(entity) === true) {
          this.bumpComponentGeneration(c, entity);
        }
      }
      this.memberships.delete(entity);
    }
    this.alive.delete(entity);
    this.canonicalCache = null;
    this.touched.record(entity);
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  add<T>(entity: Entity, component: Component<T>, value: T): T {
    const store = this.storeOrCreate(component);
    if (!store.has(entity)) this.insertMembership(entity, component as Component<unknown>);
    store.set(entity, value);
    this.bumpComponentGeneration(component as Component<unknown>, entity);
    this.touched.record(entity);
    return value;
  }

  remove<T>(entity: Entity, component: Component<T>): void {
    if (this.storeOf(component)?.delete(entity)) {
      this.removeMembership(entity, component as Component<unknown>);
      this.bumpComponentGeneration(component as Component<unknown>, entity);
      this.touched.record(entity);
    }
  }

  private insertMembership(entity: Entity, component: Component<unknown>): void {
    const index = this.registrationIndex.get(component);
    if (index === undefined) return; // unreachable: storeOrCreate registered the component
    let list = this.memberships.get(entity);
    if (list === undefined) {
      list = [];
      this.memberships.set(entity, list);
    }
    // Ascending insert keeps the walk in registration order; components register early, so the tail
    // scan is short.
    let at = list.length;
    while (at > 0) {
      const before = list[at - 1];
      if (before === undefined || before < index) break;
      at--;
    }
    list.splice(at, 0, index);
  }

  private removeMembership(entity: Entity, component: Component<unknown>): void {
    const index = this.registrationIndex.get(component);
    const list = index === undefined ? undefined : this.memberships.get(entity);
    if (index === undefined || list === undefined) return;
    const at = list.indexOf(index);
    if (at >= 0) list.splice(at, 1);
    if (list.length === 0) this.memberships.delete(entity);
  }

  private storeOf<T>(component: Component<T>): Map<Entity, T> | undefined {
    return this.stores.get(component as Component<unknown>) as Map<Entity, T> | undefined;
  }

  private storeOrCreate<T>(component: Component<T>): Map<Entity, T> {
    let store = this.storeOf(component);
    if (store === undefined) {
      store = new Map<Entity, T>();
      this.stores.set(component as Component<unknown>, store as Map<Entity, unknown>);
      this.registrationIndex.set(component as Component<unknown>, this.registered.length);
      this.registered.push(component as Component<unknown>);
    }
    return store;
  }

  /**
   * The one tracked in-place mutation seam: `entity`'s live stored `component` value, logged on every
   * change channel at once (the identity-keyed snapshot clone cache and the component's value
   * generation) so no observable write can bypass invalidation. The reference must not outlive the
   * acquiring scope - a mutation through a held reference on a later tick is unlogged. Throws when
   * `entity` does not carry `component`.
   */
  mut<T>(entity: Entity, component: Component<T>): T {
    const v = this.storeOf(component)?.get(entity);
    if (v === undefined) {
      throw new Error(`entity ${entity} has no component ${component.name}`);
    }
    this.recordValueWrite(component as Component<unknown>, entity);
    return v;
  }

  /** {@link mut} for a component the entity may not carry; an absent value logs nothing. */
  tryMut<T>(entity: Entity, component: Component<T>): T | undefined {
    const v = this.storeOf(component)?.get(entity);
    if (v !== undefined) this.recordValueWrite(component as Component<unknown>, entity);
    return v;
  }

  private recordValueWrite(component: Component<unknown>, entity: Entity): void {
    this.touched.record(entity);
    this.componentValueGenerations.set(component, (this.componentValueGenerations.get(component) ?? 0) + 1);
  }

  /** In-place value writes seen by `component`'s store so far. A cache over stored VALUES memoizes against
   *  this; one over membership uses {@link componentGeneration}. */
  componentValueGeneration(component: Component<unknown>): number {
    return this.componentValueGenerations.get(component) ?? 0;
  }

  /** Monotonic version of every entity mutation (`create`/`add`/`remove`/`destroy`/`mut`): the "may the
   *  previous snapshot be reused?" key for `Simulation.snapshot`'s per-tick memo. */
  get mutationVersion(): number {
    return this.touched.mutationCount;
  }

  drainTouched(consume: (entity: Entity) => void): boolean {
    return this.touched.drain(consume);
  }

  /** Whether a logged mutation of `entity` awaits the next {@link drainTouched}: its cached clone is
   *  scheduled for eviction, which a cache verifier must not read as staleness. */
  mutationPending(entity: Entity): boolean {
    return this.touched.pending(entity);
  }

  has<T>(entity: Entity, component: Component<T>): boolean {
    return this.storeOf(component)?.has(entity) ?? false;
  }

  get<T>(entity: Entity, component: Component<T>): DeepReadonly<T> {
    const v = this.storeOf(component)?.get(entity);
    if (v === undefined) {
      throw new Error(`entity ${entity} has no component ${component.name}`);
    }
    // Narrowing to the read-only view only drops mutation capability; the value is the live store object.
    return v as DeepReadonly<T>;
  }

  tryGet<T>(entity: Entity, component: Component<T>): DeepReadonly<T> | undefined {
    return this.storeOf(component)?.get(entity) as DeepReadonly<T> | undefined;
  }

  /** Iterate entities that have all of the given components, in the insertion order of the smallest store.
   *  O(min store size), no sorting in the hot path. For a canonical order use {@link canonicalEntities}. */
  query(...required: Array<Component<unknown>>): IterableIterator<Entity> {
    return new QueryIterator(this.stores, required);
  }

  /** The lowest-id entity carrying `component`, or null; a missing or empty store answers without
   *  allocating an iterator. */
  lowestEntityWith(component: Component<unknown>): Entity | null {
    const store = this.stores.get(component);
    if (store === undefined || store.size === 0) return null;
    let best: Entity | null = null;
    for (const e of store.keys()) {
      if (best === null || e < best) best = e;
    }
    return best;
  }

  /**
   * Ascending-sorted alive entity ids: the canonical order for snapshots, golden hashes, and any system that
   * must *pick* an entity deterministically. Shared and frozen, so a consumer that sorts or reverses it in
   * place throws at the mutation site instead of silently corrupting the order every other consumer reads.
   */
  canonicalEntities(): readonly Entity[] {
    if (this.canonicalCache === null) {
      this.canonicalCache = Object.freeze([...this.alive].sort((a, b) => a - b));
    }
    return this.canonicalCache;
  }

  /** The membership generation for one component store. A cache can memoize against this value. */
  componentGeneration(component: Component<unknown>): number {
    return this.componentGenerations.get(component) ?? 0;
  }

  registerCacheVerifier(name: string, verifier: CacheVerifier): void {
    this.cacheVerifiers.set(name, verifier);
  }

  /**
   * Recompute every incrementally-maintained cache from scratch and report mismatches with the live
   * copy (empty = coherent), so a missed invalidation surfaces at the tick it happens rather than as a
   * hash divergence later. The World's own memo is checked first and unconditionally, so no registered
   * name can shadow it.
   */
  verifyCaches(): string[] {
    const out = this.verifyCanonicalCache();
    out.push(...this.verifyMemberships());
    for (const verify of this.cacheVerifiers.values()) out.push(...verify());
    return out;
  }

  /** Re-derive the per-entity membership lists from the stores: every store entry must be listed, every
   *  listed index must be stored, and lists must ascend (registration order). */
  private verifyMemberships(): string[] {
    const out: string[] = [];
    this.registered.forEach((component, index) => {
      const store = this.stores.get(component);
      if (store === undefined) return;
      for (const e of store.keys()) {
        if (this.memberships.get(e)?.includes(index) !== true) {
          out.push(`entity ${e} carries ${component.name} but its membership list misses it`);
        }
      }
    });
    for (const [e, list] of this.memberships) {
      let previous = -1;
      for (const index of list) {
        const component = this.registered[index];
        if (component === undefined || this.stores.get(component)?.has(e) !== true) {
          out.push(`entity ${e} lists component index ${index} it does not carry`);
        }
        if (index <= previous) out.push(`entity ${e} membership list is not ascending at index ${index}`);
        previous = index;
      }
    }
    return out;
  }

  private verifyCanonicalCache(): string[] {
    const cached = this.canonicalCache;
    if (cached === null) return [];
    const out: string[] = [];
    const fresh = [...this.alive].sort((a, b) => a - b);
    if (cached.length !== fresh.length) {
      out.push(
        `canonicalEntities cache holds ${cached.length} ids but ${fresh.length} are alive - a create/destroy missed invalidation`,
      );
    } else {
      for (let i = 0; i < fresh.length; i++) {
        if (cached[i] !== fresh[i]) {
          out.push(
            `canonicalEntities cache diverges at index ${i}: cached ${cached[i]}, alive ${fresh[i]} - stale memo`,
          );
          break;
        }
      }
    }
    return out;
  }

  /** Visit an entity's components (name and live value) in registration order, without allocating.
   *  O(carried components): the membership list names them, so unrelated stores are never probed. */
  forEachComponent(entity: Entity, visit: (name: string, value: unknown) => void): void {
    const carried = this.memberships.get(entity);
    if (carried === undefined) return;
    for (const index of carried) {
      const c = this.registered[index];
      if (c === undefined) continue;
      const v = this.stores.get(c)?.get(entity);
      if (v !== undefined) visit(c.name, v);
    }
  }

  /** {@link forEachComponent} collected into an array. */
  componentEntries(entity: Entity): Array<[string, unknown]> {
    const out: Array<[string, unknown]> = [];
    this.forEachComponent(entity, (name, value) => out.push([name, value]));
    return out;
  }

  get entityCount(): number {
    return this.alive.size;
  }

  private bumpComponentGeneration(component: Component<unknown>, entity: Entity): void {
    this.componentGenerations.set(component, (this.componentGenerations.get(component) ?? 0) + 1);
    this.journals.record(component, entity);
  }

  /** Start journaling membership changes of `component`'s store so an incremental index can replay them via
   *  {@link membershipDeltasSince} instead of rebuilding on every generation bump. */
  journalMembership(component: Component<unknown>): void {
    this.journals.start(component, this.componentGeneration(component));
  }

  /** The entities whose `component` membership (or stored value, via a re-`add`) changed since generation
   *  `since`, or `null` when the caller must rebuild from the store instead. */
  membershipDeltasSince(component: Component<unknown>, since: number): readonly Entity[] | null {
    return this.journals.deltasSince(component, since);
  }
}
