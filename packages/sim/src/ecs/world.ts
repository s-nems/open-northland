/**
 * A tiny, explicit ECS. Deliberately not a library: we need full control over iteration order (for
 * determinism) and legibility.
 *
 * Rules (see docs/ECS.md):
 *  - Entities are integer ids from a monotonic counter — never recycled. Id reuse would make iteration order
 *    history-dependent in confusing ways.
 *  - Components are plain data registered via defineComponent.
 *  - Queries iterate in deterministic insertion order of the driving store (no per-call sort — a perf trap at
 *    thousands of entities). Order is reproducible across identical runs. For a canonical order
 *    (snapshots/hashes) sort ids explicitly.
 *  - Components carry no behavior; Systems (plain functions) carry all behavior.
 */

import type { Brand } from '../core/brand.js';

/** A branded entity id — a raw number can't be passed where an Entity is expected. */
export type Entity = Brand<number, 'Entity'>;

export interface Component<T> {
  readonly name: string;
  /**
   * Phantom type brand: `T` never exists at runtime (a component value is just `{ name }`), but
   * carrying it in the type keeps `Component<A>` unassignable where a `Component<B>` is expected. The
   * entity→value store lives on the {@link World}, not here — a component is a pure key, so `new World()`
   * is a complete reset with no shared state to leak between sims.
   */
  readonly __value?: T;
}

export function defineComponent<T>(name: string): Component<T> {
  return { name };
}

export class World {
  private nextId = 1;
  private readonly alive = new Set<Entity>();
  /**
   * The per-component entity→value stores, owned by this World and created on first {@link add}. Holding
   * them here (not on the shared {@link Component} key) is what makes `new World()` a complete reset — no
   * cross-sim leak, no clear-the-stores ritual. Map insertion order is registration order.
   */
  private readonly stores = new Map<Component<unknown>, Map<Entity, unknown>>();
  /** Components in first-registration order — stable, used for canonical hashing/snapshots. */
  private readonly registered: Array<Component<unknown>> = [];
  /** Per-component mutation generation, used by derived caches that depend on a component store. */
  private readonly componentGenerations = new Map<Component<unknown>, number>();
  /**
   * Optional cache verifiers registered by derived-cache owners. They run under `verifyCaches()` so a
   * stale cache is caught by the normal invariant path instead of surfacing as a distant golden drift.
   */
  private readonly cacheVerifiers = new Map<string, () => string[]>();
  /**
   * Memoized ascending-id list from {@link canonicalEntities}, rebuilt lazily and invalidated only when
   * the alive set changes ({@link create}/{@link destroy}). Without it, a system that scans the world
   * per entity (job assignment, AI target-finding) re-`[...alive].sort()`s every call — `O(n)` sorts of
   * an `O(n)` list = the quadratic stall that pinned a few-thousand-unit crowd at ~1 fps. Membership is
   * unaffected by component add/remove, so only birth/death dirties it.
   */
  private canonicalCache: readonly Entity[] | null = null;
  /**
   * Entities whose components changed since the last {@link drainTouched} — the invalidation feed for
   * identity-keyed read caches (the snapshot's per-entity clone cache). `add`/`remove`/`destroy` log
   * automatically; a system that mutates a component value in place on a cache-eligible entity must call
   * {@link touch} itself (the snapshot cache's verifier catches a missed call under invariant-checked runs).
   * Purely a read-path aid: never consulted by a sim decision, so it cannot affect determinism.
   */
  private readonly touched = new Set<Entity>();
  /** Monotonic counter of all entity mutations (create/add/remove/destroy/touch) — the snapshot memo's
   *  freshness key. Unlike "is the touched log empty" it cannot be falsified by another consumer draining
   *  the log between two same-tick snapshots. */
  private mutations = 0;
  /** Set when the touched log overflowed and was dropped wholesale (a snapshot-less soak run) —
   *  the next {@link drainTouched} reports it so the consumer discards its whole cache. */
  private touchedOverflow = false;
  /** Touched-log size past which it is dropped wholesale rather than grown forever — only reachable
   *  when nothing snapshots (headless soaks); one full cache rebuild is the entire cost. */
  private static readonly TOUCHED_OVERFLOW_LIMIT = 65536;

  create(): Entity {
    const id = this.nextId++ as Entity;
    this.alive.add(id);
    this.canonicalCache = null;
    // A snapshot emits one entry per alive id, so a bare `create()` with no components still changes the
    // snapshot — it must bump the version or the per-tick memo serves a view missing the new entity.
    this.logTouched(id);
    return id;
  }

  destroy(entity: Entity): void {
    for (const c of this.registered) {
      if (this.stores.get(c)?.delete(entity)) this.bumpComponentGeneration(c);
    }
    this.alive.delete(entity);
    this.canonicalCache = null;
    this.logTouched(entity);
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  add<T>(entity: Entity, component: Component<T>, value: T): T {
    const store = this.storeFor(component);
    store.set(entity, value);
    this.bumpComponentGeneration(component as Component<unknown>);
    this.logTouched(entity);
    return value;
  }

  remove<T>(entity: Entity, component: Component<T>): void {
    if (this.storeOf(component)?.delete(entity)) {
      this.bumpComponentGeneration(component as Component<unknown>);
      this.logTouched(entity);
    }
  }

  /** This World's store for `component`, or `undefined` if nothing was ever {@link add}ed to it. */
  private storeOf<T>(component: Component<T>): Map<Entity, T> | undefined {
    return this.stores.get(component as Component<unknown>) as Map<Entity, T> | undefined;
  }

  /** This World's store for `component`, creating (and registering) it on first use. */
  private storeFor<T>(component: Component<T>): Map<Entity, T> {
    let store = this.storeOf(component);
    if (store === undefined) {
      store = new Map<Entity, T>();
      this.stores.set(component as Component<unknown>, store as Map<Entity, unknown>);
      this.registered.push(component as Component<unknown>);
    }
    return store;
  }

  /**
   * Log an in-place component-value mutation on `entity` so identity-keyed read caches (the snapshot's
   * per-entity clone cache) drop their stale copy. `add`/`remove`/`destroy` log automatically — call this
   * only where a system writes a field of a stored value directly (e.g. the harvest effect decrementing
   * `Resource.remaining`). Read-path only; no sim decision ever consults the log.
   */
  touch(entity: Entity): void {
    this.logTouched(entity);
  }

  /**
   * Monotonic version of all entity mutations (every `create`/`add`/`remove`/`destroy`/`touch`) — the "may
   * the previous snapshot be reused?" key (`Simulation.snapshot`'s per-tick memo). A counter, not the
   * touched log's emptiness: any consumer may drain the log without falsifying another consumer's staleness
   * probe.
   */
  get mutationVersion(): number {
    return this.mutations;
  }

  /**
   * Hand every logged-touched entity to `consume` and clear the log (the snapshot clone cache evicts each
   * touched entity's cached clone). Returns `true` when the log overflowed since the last drain (dropped
   * wholesale — a long snapshot-less run): the consumer must then discard its entire cache, because the
   * individual evictions were lost.
   */
  drainTouched(consume: (entity: Entity) => void): boolean {
    for (const e of this.touched) consume(e);
    this.touched.clear();
    const overflowed = this.touchedOverflow;
    this.touchedOverflow = false;
    return overflowed;
  }

  private logTouched(entity: Entity): void {
    this.mutations++;
    if (this.touched.size >= World.TOUCHED_OVERFLOW_LIMIT) {
      // A snapshot-less soak: drop the log instead of leaking it; the next drain rebuilds the cache.
      this.touched.clear();
      this.touchedOverflow = true;
    }
    this.touched.add(entity);
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

  /**
   * Iterate entities that have all of the given components, in deterministic insertion order of the smallest
   * store. O(min store size). No sorting in the hot path.
   */
  *query(...required: Array<Component<unknown>>): IterableIterator<Entity> {
    if (required.length === 0) return;
    // Resolve every required store once, tracking the smallest to drive iteration; a never-added
    // required component means no matches at all.
    const stores: Array<Map<Entity, unknown>> = [];
    let smallest: Map<Entity, unknown> | undefined;
    for (const c of required) {
      const s = this.stores.get(c);
      if (s === undefined) return;
      stores.push(s);
      if (smallest === undefined || s.size < smallest.size) smallest = s;
    }
    if (smallest === undefined) return; // unreachable (required is non-empty), but proves it to the type

    for (const id of smallest.keys()) {
      let ok = true;
      for (const s of stores) {
        if (s !== smallest && !s.has(id)) {
          ok = false;
          break;
        }
      }
      if (ok) yield id;
    }
  }

  /**
   * Ascending-sorted alive entity ids — the canonical order for snapshots, golden hashes, and any
   * system that must *pick* an entity deterministically. Memoized per alive-set generation (see
   * {@link canonicalCache}); the result is shared + read-only — never mutate it (sort/reverse a copy).
   */
  canonicalEntities(): readonly Entity[] {
    if (this.canonicalCache === null) {
      // Frozen so a consumer that mutates the shared array (.sort()/.reverse() in place — the documented
      // never-do) throws at the mutation site instead of silently corrupting the canonical order every other
      // consumer reads (a nondeterminism that would only surface as a distant golden/desync failure).
      this.canonicalCache = Object.freeze([...this.alive].sort((a, b) => a - b));
    }
    return this.canonicalCache;
  }

  /** The mutation generation for one component store. A cache can memoize against this value. */
  componentGeneration(component: Component<unknown>): number {
    return this.componentGenerations.get(component) ?? 0;
  }

  /** Register or replace a named derived-cache verifier. The verifier must be pure over current state. */
  registerCacheVerifier(name: string, verifier: () => string[]): void {
    this.cacheVerifiers.set(name, verifier);
  }

  /**
   * Recompute every incrementally-maintained cache from scratch and report mismatches with the live copy
   * (empty = coherent). Incremental caches are the classic lockstep-desync source: a derived value must be
   * re-derivable from authoritative state at any time, so a missed invalidation shows up here, at the tick it
   * happens, not as an unexplained golden/hash divergence later. Wired into the core invariants
   * (`harness/invariants.ts`), so every invariant-checked scenario/golden/fuzz run validates it each tick.
   * Derived-cache owners register verifiers via {@link registerCacheVerifier} when they first build a cache.
   */
  verifyCaches(): string[] {
    const out: string[] = [];
    const fresh = [...this.alive].sort((a, b) => a - b);
    if (this.canonicalCache !== null && this.canonicalCache.length !== fresh.length) {
      out.push(
        `canonicalEntities cache holds ${this.canonicalCache.length} ids but ${fresh.length} are alive — a create/destroy missed invalidation`,
      );
    } else if (this.canonicalCache !== null) {
      for (let i = 0; i < fresh.length; i++) {
        if (this.canonicalCache[i] !== fresh[i]) {
          out.push(
            `canonicalEntities cache diverges at index ${i}: cached ${this.canonicalCache[i]}, alive ${fresh[i]} — stale memo`,
          );
          break;
        }
      }
    }
    for (const verify of this.cacheVerifiers.values()) out.push(...verify());
    return out;
  }

  /**
   * Canonical [componentName, value] pairs for an entity, in registration order. The single
   * traversal used by hashing and (later) snapshot/save — so "what the state is" has one
   * definition, owned by the World, not re-implemented by each consumer.
   */
  componentEntries(entity: Entity): Array<[string, unknown]> {
    const out: Array<[string, unknown]> = [];
    for (const c of this.registered) {
      const v = this.stores.get(c)?.get(entity);
      if (v !== undefined) out.push([c.name, v]);
    }
    return out;
  }

  get entityCount(): number {
    return this.alive.size;
  }

  private bumpComponentGeneration(component: Component<unknown>): void {
    this.componentGenerations.set(component, (this.componentGenerations.get(component) ?? 0) + 1);
  }
}
