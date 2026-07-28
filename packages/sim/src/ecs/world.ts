/**
 * A tiny, explicit ECS. Deliberately not a library: iteration order is a determinism contract here (see
 * docs/ECS.md). Entity ids come from a monotonic counter and are never recycled, because id reuse would make
 * iteration order history-dependent. Components are plain data keys; systems (plain functions) carry all
 * behavior.
 */

import type { Component, Entity } from './component.js';
import { MembershipJournals } from './membership-journal.js';
import { QueryIterator } from './query-iterator.js';
import { TouchedLog } from './touched-log.js';

export type { Component, Entity } from './component.js';
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
  /** Per-component membership (add/remove/destroy) generation, used by derived caches that depend on a
   *  component store. */
  private readonly componentGenerations = new Map<Component<unknown>, number>();
  /** Per-component in-place value-write generation (see {@link write}), separate from the membership
   *  generations above so spatial indexes keyed on add/remove stay unaffected. */
  private readonly componentValueGenerations = new Map<Component<unknown>, number>();
  private readonly journals = new MembershipJournals();
  private readonly touched = new TouchedLog();
  /** Derived-cache verifiers by name, run in first-registration order; registering a name again replaces the
   *  verifier but keeps its position. */
  private readonly cacheVerifiers = new Map<string, CacheVerifier>();
  /** Memoized ascending-id list from {@link canonicalEntities}, invalidated only by {@link create}/
   *  {@link destroy} since component add/remove cannot change membership. Without it a system that scans the
   *  world per entity re-sorts the whole alive set per call: the quadratic stall that pinned a few-thousand
   *  unit crowd at ~1 fps. */
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
    for (const c of this.registered) {
      if (this.stores.get(c)?.delete(entity)) this.bumpComponentGeneration(c, entity);
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
    store.set(entity, value);
    this.bumpComponentGeneration(component as Component<unknown>, entity);
    this.touched.record(entity);
    return value;
  }

  remove<T>(entity: Entity, component: Component<T>): void {
    if (this.storeOf(component)?.delete(entity)) {
      this.bumpComponentGeneration(component as Component<unknown>, entity);
      this.touched.record(entity);
    }
  }

  private storeOf<T>(component: Component<T>): Map<Entity, T> | undefined {
    return this.stores.get(component as Component<unknown>) as Map<Entity, T> | undefined;
  }

  private storeOrCreate<T>(component: Component<T>): Map<Entity, T> {
    let store = this.storeOf(component);
    if (store === undefined) {
      store = new Map<Entity, T>();
      this.stores.set(component as Component<unknown>, store as Map<Entity, unknown>);
      this.registered.push(component as Component<unknown>);
    }
    return store;
  }

  /**
   * Apply an in-place mutation to `entity`'s stored `component` value and log it on every change channel at
   * once (the identity-keyed snapshot clone cache and the component's value generation). Required for any
   * write a derived cache can observe; `add`/`remove`/`destroy` log for themselves, and a raw
   * `get(...).field = x` reaches no channel — the staleness {@link verifyCaches} exists to catch.
   * Throws when `entity` does not carry `component`; a caller that tolerates a raced-away entity tests
   * with {@link has}/{@link tryGet} first.
   */
  write<T>(entity: Entity, component: Component<T>, mutate: (value: T) => void): void {
    mutate(this.get(entity, component));
    this.touched.record(entity);
    const key = component as Component<unknown>;
    this.componentValueGenerations.set(key, (this.componentValueGenerations.get(key) ?? 0) + 1);
  }

  /** In-place value writes seen by `component`'s store so far. A cache over stored VALUES memoizes against
   *  this; one over membership uses {@link componentGeneration}. */
  componentValueGeneration(component: Component<unknown>): number {
    return this.componentValueGenerations.get(component) ?? 0;
  }

  /** Monotonic version of every entity mutation (`create`/`add`/`remove`/`destroy`/`write`): the "may the
   *  previous snapshot be reused?" key for `Simulation.snapshot`'s per-tick memo. */
  get mutationVersion(): number {
    return this.touched.mutationCount;
  }

  drainTouched(consume: (entity: Entity) => void): boolean {
    return this.touched.drain(consume);
  }

  has<T>(entity: Entity, component: Component<T>): boolean {
    return this.storeOf(component)?.has(entity) ?? false;
  }

  get<T>(entity: Entity, component: Component<T>): T {
    const v = this.storeOf(component)?.get(entity);
    if (v === undefined) {
      throw new Error(`entity ${entity} has no component ${component.name}`);
    }
    return v;
  }

  tryGet<T>(entity: Entity, component: Component<T>): T | undefined {
    return this.storeOf(component)?.get(entity);
  }

  /** Iterate entities that have all of the given components, in the insertion order of the smallest store.
   *  O(min store size), no sorting in the hot path. For a canonical order use {@link canonicalEntities}. */
  query(...required: Array<Component<unknown>>): IterableIterator<Entity> {
    return new QueryIterator(this.stores, required);
  }

  /** The lowest-id entity carrying `component`, or null. The world-rules singleton read called from hot
   *  per-candidate gates: a missing or empty store answers without allocating an iterator. */
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
   * Recompute every incrementally-maintained cache from scratch and report mismatches with the live copy
   * (empty = coherent). Incremental caches are the classic lockstep-desync source, so a missed invalidation
   * shows up here, at the tick it happens, not as an unexplained hash divergence later: `harness/invariants.ts`
   * runs it every tick of an invariant-checked scenario/golden/fuzz run. The World's own memo is checked
   * first and unconditionally, so no registered name can shadow it.
   */
  verifyCaches(): string[] {
    const out = this.verifyCanonicalCache();
    for (const verify of this.cacheVerifiers.values()) out.push(...verify());
    return out;
  }

  private verifyCanonicalCache(): string[] {
    const cached = this.canonicalCache;
    if (cached === null) return [];
    const out: string[] = [];
    const fresh = [...this.alive].sort((a, b) => a - b);
    if (cached.length !== fresh.length) {
      out.push(
        `canonicalEntities cache holds ${cached.length} ids but ${fresh.length} are alive — a create/destroy missed invalidation`,
      );
    } else {
      for (let i = 0; i < fresh.length; i++) {
        if (cached[i] !== fresh[i]) {
          out.push(
            `canonicalEntities cache diverges at index ${i}: cached ${cached[i]}, alive ${fresh[i]} — stale memo`,
          );
          break;
        }
      }
    }
    return out;
  }

  /**
   * Visit an entity's components (name + live value) in registration order: the single canonical traversal
   * "what the state is" has. Allocation-free, because the per-frame snapshot clone runs it per entity.
   */
  forEachComponent(entity: Entity, visit: (name: string, value: unknown) => void): void {
    for (const c of this.registered) {
      const v = this.stores.get(c)?.get(entity);
      if (v !== undefined) visit(c.name, v);
    }
  }

  /** {@link forEachComponent} collected into an array, for callers that want a materialized list. */
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
