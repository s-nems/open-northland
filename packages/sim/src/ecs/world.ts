/**
 * A tiny, explicit ECS. Deliberately not a library: iteration order is a determinism contract here (see
 * docs/ECS.md). Entity ids come from a monotonic counter and are never recycled, because id reuse would make
 * iteration order history-dependent.
 */

import { AliveEntities } from './alive-entities.js';
import { type CacheVerifier, CacheVerifiers } from './cache-verifier.js';
import { CanonicalQueries } from './canonical-queries.js';
import { ChangeFeed, ChangeFeeds } from './change-feed.js';
import type { Component, DeepReadonly, Entity } from './component.js';
import { ABSENT_SLOT, ComponentStore, VACANT_SLOT } from './component-store.js';
import { GenerationJournals } from './generation-journal.js';
import { EntityMemberships } from './memberships.js';
import { QueryIterator } from './query-iterator.js';
import { TouchedLog } from './touched-log.js';

export type { CacheVerifier } from './cache-verifier.js';
export type { ChangeFeed } from './change-feed.js';
export type { Component, DeepReadonly, Entity } from './component.js';
export { defineComponent } from './component.js';
export { SYNC_DOMAINS, type SyncDomain } from './sync-domain.js';

/**
 * The per-tick mutation feed a sync digest folds. `World` reports through it and reads nothing back, so
 * an installed sink cannot change what the world does; a run that installs none pays one null check per
 * mutation.
 */
export interface MutationSink {
  /** `component`'s stored value for `entity` was added, acquired through {@link World.mut}, or removed. */
  componentWritten(component: Component<unknown>, entity: Entity): void;
  /** `entity` entered or left the alive set. */
  allocationChanged(entity: Entity): void;
}

export class World {
  private nextId = 1;
  private readonly alive = new AliveEntities();
  /** The per-component entity→value stores, created on first {@link add}. Each store's insertion order is the
   *  query iteration order. */
  private readonly stores = new Map<Component<unknown>, ComponentStore<unknown>>();
  /** The same stores indexed by {@link Component.id}, the per-read lookup; {@link stores} keeps the
   *  query and verifier seams. */
  private readonly storesById: Array<ComponentStore<unknown> | undefined> = [];
  /** Components in first-registration order: stable, used for canonical hashing/snapshots. */
  private readonly registered: Array<Component<unknown>> = [];
  /** Each component's index into {@link registered} by {@link Component.id}, assigned on first {@link add}. */
  private readonly registrationIndex: Array<number | undefined> = [];
  /** Per-entity carried components as registration indices, so a component walk visits the entity's own
   *  components in registration order instead of probing every registered store. */
  private readonly memberships = new EntityMemberships();
  /** Per-component membership (add/remove/destroy) generation by {@link Component.id}, used by derived
   *  caches that depend on a component store. */
  private readonly componentGenerations: Array<number | undefined> = [];
  /** Per-component in-place value-write generation (see {@link mut}), separate from the membership
   *  generations above so spatial indexes keyed on add/remove stay unaffected. */
  private readonly componentValueGenerations: Array<number | undefined> = [];
  private readonly membershipJournals = new GenerationJournals();
  private readonly valueJournals = new GenerationJournals();
  private readonly changeFeeds = new ChangeFeeds();
  private readonly touched = new TouchedLog();
  private readonly cacheVerifiers = new CacheVerifiers();
  private readonly canonicalQueries = new CanonicalQueries(this.stores);
  private mutations: MutationSink | null = null;
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
    this.mutations?.allocationChanged(id);
    return id;
  }

  destroy(entity: Entity): void {
    const memberships = this.memberships;
    for (let index = memberships.next(entity, -1); index >= 0; index = memberships.next(entity, index)) {
      const c = this.registered[index];
      if (c !== undefined && this.storeOf(c)?.delete(entity) === true) {
        this.canonicalQueries.changed(c, entity);
        this.bumpComponentGeneration(c, entity);
        this.mutations?.componentWritten(c, entity);
      }
    }
    memberships.clear(entity);
    this.alive.delete(entity);
    this.canonicalCache = null;
    this.touched.record(entity);
    this.mutations?.allocationChanged(entity);
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  add<T>(entity: Entity, component: Component<T>, value: T): T {
    const entering = this.storeOrCreate(component).set(entity, value);
    if (entering) {
      this.insertMembership(entity, component as Component<unknown>);
      this.canonicalQueries.changed(component as Component<unknown>, entity);
    }
    this.bumpComponentGeneration(component as Component<unknown>, entity);
    this.recordComponentWrite(component as Component<unknown>, entity, entering);
    return value;
  }

  remove<T>(entity: Entity, component: Component<T>): void {
    if (this.storeOf(component)?.delete(entity)) {
      this.removeMembership(entity, component as Component<unknown>);
      this.canonicalQueries.changed(component as Component<unknown>, entity);
      this.bumpComponentGeneration(component as Component<unknown>, entity);
      // The removed value's revision leaves with its slot; the touch keeps its cached clone from surviving.
      this.touched.record(entity, component as Component<unknown>, true);
      this.mutations?.componentWritten(component as Component<unknown>, entity);
    }
  }

  private insertMembership(entity: Entity, component: Component<unknown>): void {
    const index = this.registrationIndex[component.id];
    if (index !== undefined) this.memberships.add(entity, index);
  }

  private removeMembership(entity: Entity, component: Component<unknown>): void {
    const index = this.registrationIndex[component.id];
    if (index !== undefined) this.memberships.remove(entity, index);
  }

  private storeOf<T>(component: Component<T>): ComponentStore<T> | undefined {
    return this.storesById[component.id] as ComponentStore<T> | undefined;
  }

  private storeOrCreate<T>(component: Component<T>): ComponentStore<T> {
    let store = this.storeOf(component);
    if (store === undefined) {
      store = new ComponentStore<T>();
      this.stores.set(component as Component<unknown>, store as ComponentStore<unknown>);
      this.storesById[component.id] = store as ComponentStore<unknown>;
      this.registrationIndex[component.id] = this.registered.length;
      this.registered.push(component as Component<unknown>);
    }
    return store;
  }

  /**
   * The one tracked in-place mutation seam: `entity`'s live stored `component` value, logged on every
   * change channel at once (the touched-entity log, the stored value's revision, and the component-wide
   * value generation) so no observable write can bypass invalidation. The reference must not outlive
   * the acquiring scope - a mutation through a held reference on a later tick is unlogged. Throws when
   * `entity` does not carry `component`.
   */
  mut<T>(entity: Entity, component: Component<T>): T {
    const v = this.tryMut(entity, component);
    if (v === undefined) {
      throw new Error(`entity ${entity} has no component ${component.name}`);
    }
    return v;
  }

  /** {@link mut} for a component the entity may not carry; an absent value logs nothing. */
  tryMut<T>(entity: Entity, component: Component<T>): T | undefined {
    const store = this.storeOf(component);
    if (store === undefined) return undefined;
    const slot = store.slotOf(entity);
    const v = store.valueAt(slot);
    if (v === undefined) return undefined;
    store.setRevisionAt(slot, this.touched.record(entity, component as Component<unknown>, false));
    this.mutations?.componentWritten(component as Component<unknown>, entity);
    this.recordValueWrite(component as Component<unknown>, entity);
    return v;
  }

  /**
   * {@link mut} for a write no read view sees: of `component`'s `simOnlyFields` alone, or none at all for
   * the value channels' sake. Logged on the revision, value and digest channels but not the touched log,
   * so no snapshot delta carries it. A read-view field written through it leaves snapshot clones stale,
   * which `verifyCaches` reports.
   */
  mutUnseen<T>(entity: Entity, component: Component<T>): T {
    const store = this.storeOf(component);
    const slot = store === undefined ? ABSENT_SLOT : store.slotOf(entity);
    const v = store?.valueAt(slot);
    if (store === undefined || v === undefined)
      throw new Error(`entity ${entity} has no component ${component.name}`);
    store.setRevisionAt(slot, this.touched.recordUnlisted());
    this.mutations?.componentWritten(component as Component<unknown>, entity);
    this.recordValueWrite(component as Component<unknown>, entity);
    return v;
  }

  /** The value-write channels {@link tryMut} logs beside the revision and touch. */
  private recordValueWrite(component: Component<unknown>, entity: Entity): void {
    this.componentValueGenerations[component.id] = (this.componentValueGenerations[component.id] ?? 0) + 1;
    this.valueJournals.record(component, entity);
    this.changeFeeds.valueWritten(component, entity);
  }

  private recordComponentWrite(component: Component<unknown>, entity: Entity, membership = false): void {
    this.storeOf(component)?.setRevision(entity, this.touched.record(entity, component, membership));
    this.mutations?.componentWritten(component, entity);
  }

  /** In-place value writes seen by `component`'s store so far. A cache over stored VALUES memoizes against
   *  this; one over membership uses {@link componentGeneration}. */
  componentValueGeneration(component: Component<unknown>): number {
    return this.componentValueGenerations[component.id] ?? 0;
  }

  /** The revision of `entity`'s stored `component` value, undefined while it carries none. A fresh value
   *  from every {@link add} and {@link mut}, so a cache keyed on it re-derives after any write. */
  revisionOf(entity: Entity, component: Component<unknown>): number | undefined {
    const store = this.storeOf(component);
    const slot = store === undefined ? ABSENT_SLOT : store.slotOf(entity);
    return store === undefined || slot === ABSENT_SLOT ? undefined : store.revisionAt(slot);
  }

  /** Monotonic version of every entity mutation (`create`/`add`/`remove`/`destroy`/`mut`): the "may the
   *  previous snapshot be reused?" key for `Simulation.snapshot`'s per-tick memo. */
  get mutationVersion(): number {
    return this.touched.mutationCount;
  }

  /** Install (or clear) the {@link MutationSink} a sync digest folds from. */
  setMutationSink(sink: MutationSink | null): void {
    this.mutations = sink;
  }

  /** Enable component details for the snapshot cache's lifetime, including after streams close. */
  trackTouchedComponents(): void {
    this.touched.trackComponents();
  }

  /** A component list is lent only for the duration of `consume`, and only its first `count` entries are
   *  the entity's. */
  drainTouched(
    consume: (
      entity: Entity,
      components: readonly Component<unknown>[],
      count: number,
      membership: boolean,
    ) => void,
  ): boolean {
    return this.touched.drain(consume);
  }

  /** Whether a logged mutation of `entity` awaits the next {@link drainTouched}: its cached clone is
   *  scheduled for refresh, which a cache verifier must not read as staleness. */
  mutationPending(entity: Entity): boolean {
    return this.touched.pending(entity);
  }

  has<T>(entity: Entity, component: Component<T>): boolean {
    const store = this.storesById[component.id];
    return store !== undefined && store.has(entity);
  }

  get<T>(entity: Entity, component: Component<T>): DeepReadonly<T> {
    const v = this.storesById[component.id]?.get(entity);
    if (v === undefined) {
      throw new Error(`entity ${entity} has no component ${component.name}`);
    }
    // Narrowing to the read-only view only drops mutation capability; the value is the live store object.
    return v as DeepReadonly<T>;
  }

  tryGet<T>(entity: Entity, component: Component<T>): DeepReadonly<T> | undefined {
    return this.storesById[component.id]?.get(entity) as DeepReadonly<T> | undefined;
  }

  /** Iterate entities that have all of the given components, in the insertion order of the smallest store.
   *  O(min store size), no sorting in the hot path. For a canonical order use {@link canonicalEntities}. */
  query(...required: Array<Component<unknown>>): IterableIterator<Entity> {
    return new QueryIterator(this.storesById, required);
  }

  /** The lowest-id entity carrying `component`, or null; a missing or empty store answers without
   *  allocating an iterator. */
  lowestEntityWith(component: Component<unknown>): Entity | null {
    const store = this.storeOf(component);
    if (store === undefined || store.size === 0) return null;
    let best: number = VACANT_SLOT;
    const { entities, length } = store;
    for (let slot = 0; slot < length; slot++) {
      const e = entities[slot] ?? VACANT_SLOT;
      if (e !== VACANT_SLOT && (best === VACANT_SLOT || e < best)) best = e;
    }
    return best === VACANT_SLOT ? null : (best as Entity);
  }

  /** The value the lowest-id carrier of `component` holds, or undefined while nothing carries it:
   *  {@link lowestEntityWith} and {@link get} in one walk of the store, for a world singleton's read. */
  lowestValue<T>(component: Component<T>): DeepReadonly<T> | undefined {
    const store = this.storeOf(component);
    if (store === undefined || store.size === 0) return undefined;
    let best: number = VACANT_SLOT;
    let bestSlot: number = ABSENT_SLOT;
    const { entities, length } = store;
    for (let slot = 0; slot < length; slot++) {
      const e = entities[slot] ?? VACANT_SLOT;
      if (e !== VACANT_SLOT && (best === VACANT_SLOT || e < best)) {
        best = e;
        bestSlot = slot;
      }
    }
    return store.valueAt(bestSlot) as DeepReadonly<T> | undefined;
  }

  /** The entities carrying every `required` component in ascending id: {@link query} in canonical order,
   *  shared like {@link canonicalEntities}. A caller that reorders or edits the list copies it. */
  canonicalQuery(...required: Array<Component<unknown>>): readonly Entity[] {
    return this.canonicalQueries.query(required);
  }

  /**
   * Ascending-sorted alive entity ids: the canonical order for snapshots, golden hashes, and any system that
   * must *pick* an entity deterministically. Shared and not frozen (a frozen array costs every `for...of`
   * an iterator result per element): a consumer that sorts or edits it copies first, and
   * {@link verifyCaches} reports one that did not.
   */
  canonicalEntities(): readonly Entity[] {
    if (this.canonicalCache === null) {
      this.canonicalCache = this.alive.ascending();
    }
    return this.canonicalCache;
  }

  /** The membership generation for one component store. A cache can memoize against this value. */
  componentGeneration(component: Component<unknown>): number {
    return this.componentGenerations[component.id] ?? 0;
  }

  registerCacheVerifier(name: string, verifier: CacheVerifier): void {
    this.cacheVerifiers.register(name, verifier);
  }

  /** Recompute every incrementally-maintained cache and report mismatches with the live copy (empty =
   *  coherent), so a missed invalidation surfaces at the tick it happens rather than as a hash divergence
   *  later. Off the tick path: an invariant and test seam, never called by a system. */
  verifyCaches(): string[] {
    return this.cacheVerifiers.run({
      alive: this.alive,
      stores: this.stores,
      registered: this.registered,
      memberships: this.memberships,
      canonicalCache: this.canonicalCache,
      canonicalQueries: this.canonicalQueries,
    });
  }

  /** The id the next {@link create} takes; with the alive set this is the complete allocation state. */
  get nextEntityId(): number {
    return this.nextId;
  }

  /** Visit every component store in first-registration order, entries in per-store insertion order
   *  (the query iteration contract). Values are live; a persisting visitor must clone them. A visitor
   *  must not remove components while it walks: the entries throw once their store compacts. */
  forEachStore(visit: (name: string, entries: IterableIterator<[Entity, unknown]>) => void): void {
    for (const c of this.registered) {
      const store = this.stores.get(c);
      if (store !== undefined) visit(c.name, store.entries());
    }
  }

  /** Restore seam: adopt a saved allocation state verbatim; only valid on a world that has never
   *  allocated, so a restore cannot splice into live state. */
  restoreAllocation(nextId: number, alive: readonly Entity[]): void {
    if (this.nextId !== 1 || this.alive.size > 0) {
      throw new Error('restoreAllocation: the world has already allocated entities');
    }
    this.nextId = nextId;
    for (const e of alive) this.alive.add(e);
    this.canonicalCache = null;
  }

  /** Restore seam: register `component` and fill its store in the given entry order, so a restored
   *  world's registration and iteration orders are exactly the saved ones. Values must be detached
   *  copies; only valid while the store is unregistered. */
  restoreStore(component: Component<unknown>, entries: ReadonlyArray<readonly [Entity, unknown]>): void {
    if (this.stores.has(component)) {
      throw new Error(`restoreStore: component '${component.name}' is already registered`);
    }
    const store = this.storeOrCreate(component);
    for (const [entity, value] of entries) {
      const entering = store.set(entity, value);
      if (entering) this.insertMembership(entity, component);
      // A fresh revision and a logged write per value, so revision-keyed caches and the change feeds see
      // each restored value as written instead of reading the default revision 0.
      this.recordComponentWrite(component, entity, entering);
    }
    // One bump for the whole fill: a cache built against generation 0 must not read as current over
    // a store this call populated.
    this.componentGenerations[component.id] = this.componentGeneration(component) + 1;
    this.changeFeeds.storeReplaced(component);
  }

  /** Visit an entity's components in registration order and O(carried components), without allocating.
   *  The revision changes only when this stored value is added or acquired through {@link mut}. A read
   *  view passes `readView` to skip the {@link Component.simOnly} ones. */
  forEachComponent(
    entity: Entity,
    visit: (name: string, value: unknown, revision: number, component: Component<unknown>) => void,
    readView = false,
  ): void {
    const memberships = this.memberships;
    for (let index = memberships.next(entity, -1); index >= 0; index = memberships.next(entity, index)) {
      const c = this.registered[index];
      if (c === undefined || (readView && c.simOnly)) continue;
      const store = this.storeOf(c);
      if (store === undefined) continue;
      const slot = store.slotOf(entity);
      const v = store.valueAt(slot);
      if (v === undefined) continue;
      visit(c.name, v, store.revisionAt(slot), c);
    }
  }

  /** Stable first-registration order for canonical component output. */
  componentOrder(component: Component<unknown>): number {
    const index = this.registrationIndex[component.id];
    if (index === undefined) throw new Error(`component '${component.name}' is not registered in this world`);
    return index;
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
    this.componentGenerations[component.id] = this.componentGeneration(component) + 1;
    this.membershipJournals.record(component, entity);
    this.changeFeeds.membershipChanged(component, entity);
  }

  /** Start journaling membership changes of `component`'s store so an incremental index can replay them via
   *  {@link membershipDeltasSince} instead of rebuilding on every generation bump. */
  journalMembership(component: Component<unknown>): void {
    this.membershipJournals.start(component, this.componentGeneration(component));
  }

  /** The entities whose `component` membership (or stored value, via a re-`add`) changed since generation
   *  `since`, or `null` when the caller must rebuild from the store instead. */
  membershipDeltasSince(component: Component<unknown>, since: number): readonly Entity[] | null {
    return this.membershipJournals.deltasSince(component, since);
  }

  /** {@link membershipDeltasSince} handed to `visit` without collecting them; false when the caller must
   *  rebuild instead. */
  replayMembershipSince(
    component: Component<unknown>,
    since: number,
    visit: (entity: Entity) => void,
  ): boolean {
    return this.membershipJournals.replaySince(component, since, visit);
  }

  /** A feed of the entities whose `membership` stores (adds, re-adds, removes, destroys) or `values`
   *  stores (writes acquired through {@link mut}/{@link tryMut}) change from now on: one log for an
   *  incremental view over several stores. It records for the world's lifetime. */
  watchChanges(membership: readonly Component<unknown>[], values: readonly Component<unknown>[]): ChangeFeed {
    const feed = new ChangeFeed();
    this.changeFeeds.watch(feed, membership, values);
    return feed;
  }

  /** Start journaling `component`'s in-place value writes so a cache that reads one field can replay the
   *  written entities via {@link valueWritesSince} instead of re-deriving on every value-generation bump. */
  journalValueWrites(component: Component<unknown>): void {
    this.valueJournals.start(component, this.componentValueGeneration(component));
  }

  /** The entities acquired through {@link mut}/{@link tryMut} for `component` since value generation
   *  `since`, or `null` when the caller must re-derive instead. */
  valueWritesSince(component: Component<unknown>, since: number): readonly Entity[] | null {
    return this.valueJournals.deltasSince(component, since);
  }

  /** {@link valueWritesSince} handed to `visit` without collecting them; false when the caller must
   *  re-derive instead. */
  replayValueWritesSince(
    component: Component<unknown>,
    since: number,
    visit: (entity: Entity) => void,
  ): boolean {
    return this.valueJournals.replaySince(component, since, visit);
  }
}
