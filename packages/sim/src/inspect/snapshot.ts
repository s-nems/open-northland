import type { SimEvent } from '../core/events.js';
import { isPlainRecord, sortedMapEntries, valueShapeName } from '../core/plain-value.js';
import type { Entity, World } from '../ecs/world.js';

/**
 * The detached view render and audio read instead of the live component stores, taken after a `step()`
 * completes. Every value is plain data with no class instances or live `Map`s, so a consumer can never
 * reach the live store and the whole structure survives the structured clone algorithm at a worker
 * boundary. Not a save format.
 */
export interface WorldSnapshot {
  readonly tick: number;
  /** One entity per alive id, in canonical (ascending) order. */
  readonly entities: readonly EntitySnapshot[];
  /** The one-shot events produced during the tick this snapshot was taken after. */
  readonly events: readonly SimEvent[];
}

export interface EntitySnapshot {
  readonly id: number;
  /** componentName -> a plain-cloned copy of its value (Maps become `[key, value]` arrays). */
  readonly components: Readonly<Record<string, unknown>>;
}

export interface HomeQualityView {
  readonly cooking: number;
  readonly rest: number;
  readonly piety: number;
}

export interface HomeQualityPolicyView {
  readonly cooking: boolean;
  readonly rest: boolean;
  readonly piety: boolean;
}

/** Decode one home's detached quality pools from a snapshot. */
export function homeQualityView(snapshot: WorldSnapshot, home: number): HomeQualityView | null {
  const raw = entityById(snapshot, home)?.components.HomeQuality;
  if (!isPlainRecord(raw)) return null;
  const { cooking, rest, piety } = raw;
  if (typeof cooking !== 'number' || typeof rest !== 'number' || typeof piety !== 'number') return null;
  return { cooking, rest, piety };
}

/** Decode one home's use policy. An absent policy is the default-allowed state. */
export function homeQualityPolicyView(snapshot: WorldSnapshot, home: number): HomeQualityPolicyView | null {
  const entity = entityById(snapshot, home);
  if (entity === undefined) return null;
  const raw = entity.components.HomeQualityPolicy;
  if (raw === undefined) return { cooking: true, rest: true, piety: true };
  if (!isPlainRecord(raw)) return null;
  const { cooking, rest, piety } = raw;
  if (typeof cooking !== 'boolean' || typeof rest !== 'boolean' || typeof piety !== 'boolean') return null;
  return { cooking, rest, piety };
}

/**
 * Per-world cache of cloned entity snapshots. Untouched entities reuse the whole entry; touched entities
 * reuse every component whose per-entity revision still matches. A registered cache verifier re-clones
 * and compares, so a mutation that bypasses `World.mut` fails invariant-checked runs.
 */
interface CachedEntity {
  readonly snap: EntitySnapshot;
  readonly componentRevisions: Readonly<Record<string, number>>;
  dirty: boolean;
}

const cloneCaches = new WeakMap<World, Map<Entity, CachedEntity>>();

function cloneCacheFor(world: World): Map<Entity, CachedEntity> {
  let cache = cloneCaches.get(world);
  if (cache === undefined) {
    const created = new Map<Entity, CachedEntity>();
    cache = created;
    cloneCaches.set(world, created);
    world.registerCacheVerifier('snapshotClones', () => verifyClones(world, created));
  }
  return cache;
}

function cloneEntity(world: World, id: Entity, previous?: CachedEntity): CachedEntity {
  const components: Record<string, unknown> = {};
  const componentRevisions: Record<string, number> = {};
  world.forEachComponent(id, (name, value, revision) => {
    components[name] =
      previous?.componentRevisions[name] === revision ? previous.snap.components[name] : clonePlain(value);
    componentRevisions[name] = revision;
  });
  return { snap: { id: id as number, components }, componentRevisions, dirty: false };
}

function verifyClones(world: World, cache: ReadonlyMap<Entity, CachedEntity>): string[] {
  const out: string[] = [];
  for (const [id, cached] of cache) {
    if (!world.isAlive(id)) continue; // evicted lazily on the next drain - absence is not incoherence
    if (world.mutationPending(id)) continue; // logged for refresh - scheduled staleness, not a bypass
    const fresh = cloneEntity(world, id);
    if (JSON.stringify(fresh.snap.components) !== JSON.stringify(cached.snap.components)) {
      out.push(`snapshot clone of entity ${id} is stale - an in-place mutation bypassed World.mut`);
    }
  }
  return out;
}

/**
 * Capture a detached snapshot of the world and the tick's events at a tick boundary. Entities are
 * emitted in canonical ascending-id order and `Map` values become sorted `[key, value]` arrays, the same
 * canonical ordering `hashState` uses. An untouched entity reuses its cached clone object; a touched one
 * receives a new entity object while retaining the detached clones of unchanged components.
 */
export function takeSnapshot(world: World, tick: number, events: readonly SimEvent[]): WorldSnapshot {
  const cache = cloneCacheFor(world);
  // An overflowed log (a long snapshot-less run) lost its individual evictions - drop everything.
  if (
    world.drainTouched((e) => {
      const cached = cache.get(e);
      if (cached === undefined) return;
      if (world.isAlive(e)) cached.dirty = true;
      else cache.delete(e);
    })
  ) {
    cache.clear();
  }
  const entities: EntitySnapshot[] = [];
  for (const id of world.canonicalEntities()) {
    let cached = cache.get(id);
    if (cached === undefined || cached.dirty) {
      cached = cloneEntity(world, id, cached);
      cache.set(id, cached);
    }
    entities.push(cached.snap);
  }
  // SimEvents carry no Map fields, so PlainOf<SimEvent> is structurally a SimEvent and this cast holds.
  // Adding one would lower it to a [k, v] array and break the cast.
  return { tick, entities, events: events.map(clonePlain) as readonly SimEvent[] };
}

/**
 * The snapshot entity with `id`, or `undefined` once it has left the snapshot. Binary search: a narrowed
 * view that re-orders `entities` breaks the ascending-id precondition and must not be passed here.
 */
export function entityById(snapshot: WorldSnapshot, id: number): EntitySnapshot | undefined {
  const entities = snapshot.entities;
  let lo = 0;
  let hi = entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const found = entities[mid];
    if (found === undefined) break; // unreachable: mid is always within bounds
    if (found.id === id) return found;
    if (found.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/**
 * The plain shape {@link clonePlain} produces from `T`. `extends object` cannot express "plain record", so
 * shapes the clone rejects (a `Set`, a class instance, `bigint`, `symbol`, a function) still satisfy this
 * type and are rejected at runtime instead.
 */
type PlainOf<T> = T extends null | undefined | string | number | boolean | bigint | symbol
  ? T // branded primitives included: an `Entity` stays a number at runtime
  : T extends Map<infer K, infer V>
    ? [PlainOf<K>, PlainOf<V>][]
    : T extends readonly (infer E)[]
      ? PlainOf<E>[]
      : T extends object
        ? { [K in keyof T]: PlainOf<T[K]> }
        : T;

/**
 * Deep-clone a value to plain data. Object keys keep insertion order because a component value is a
 * fixed-shape literal whose keys are already deterministic; `Map` entries are sorted because a Map's key
 * set varies at runtime and snapshot-diff's canonical-JSON equality depends on that ordering.
 *
 * The wide implementation signature lets the body build the plain value without a cast: a conditional type
 * cannot be proven over the unresolved generic `T`.
 */
function clonePlain<T>(value: T): PlainOf<T>;
function clonePlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') throw uncloneable(value); // bigint, symbol, function
  if (value instanceof Map) {
    return sortedMapEntries(value).map(([k, v]) => [clonePlain(k), clonePlain(v)]);
  }
  if (Array.isArray(value)) return value.map((e) => clonePlain(e));
  if (!isPlainRecord(value)) throw uncloneable(value);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value)) {
    out[k] = clonePlain(value[k]);
  }
  return out;
}

function uncloneable(value: unknown): Error {
  return new Error(`snapshot: uncloneable value shape ${valueShapeName(value)}`);
}
