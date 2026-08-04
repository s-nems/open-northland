import { BerryBush, Resource, Stump } from '../components/economy/index.js';
import type { SimEvent } from '../core/events.js';
import { isPlainRecord, valueShapeName } from '../core/plain-value.js';
import type { Entity, World } from '../ecs/world.js';

/**
 * The detached view render and audio read instead of the live component stores, taken after a `step()`
 * completes. Every value is plain data with no class instances or live `Map`s, so a consumer can never
 * reach the live store and the whole structure is transferable to another thread. Not a save format.
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

/**
 * Per-world cache of cloned scenery snapshots, so standing forests cost O(changed) per snapshot instead of
 * O(map). An entry is reused until the World's touched-entity log names its entity, which requires every
 * mutation of a cached entity to go through `World.write` or an add/remove/destroy. A registered cache
 * verifier re-clones and compares, so a mutation that bypasses that seam fails invariant-checked runs.
 */
const sceneryClones = new WeakMap<World, Map<Entity, EntitySnapshot>>();

function sceneryCloneCache(world: World): Map<Entity, EntitySnapshot> {
  let cache = sceneryClones.get(world);
  if (cache === undefined) {
    const created = new Map<Entity, EntitySnapshot>();
    cache = created;
    sceneryClones.set(world, created);
    world.registerCacheVerifier('snapshotSceneryClones', () => verifySceneryClones(world, created));
  }
  return cache;
}

function cloneEntity(world: World, id: Entity): EntitySnapshot {
  const components: Record<string, unknown> = {};
  world.forEachComponent(id, (name, value) => {
    components[name] = clonePlain(value);
  });
  return { id: id as number, components };
}

function verifySceneryClones(world: World, cache: ReadonlyMap<Entity, EntitySnapshot>): string[] {
  const out: string[] = [];
  for (const [id, cached] of cache) {
    if (!world.isAlive(id)) continue; // evicted lazily on the next drain - absence is not incoherence
    const fresh = cloneEntity(world, id);
    if (JSON.stringify(fresh.components) !== JSON.stringify(cached.components)) {
      out.push(`snapshot scenery clone of entity ${id} is stale - an in-place mutation bypassed World.write`);
    }
  }
  return out;
}

/**
 * Capture a detached snapshot of the world and the tick's events at a tick boundary. Entities are
 * emitted in canonical ascending-id order and `Map` values become sorted `[key, value]` arrays, the same
 * canonical ordering `hashState` uses. Unchanged scenery entities reuse their cached clone object.
 */
export function takeSnapshot(world: World, tick: number, events: readonly SimEvent[]): WorldSnapshot {
  const cache = sceneryCloneCache(world);
  // An overflowed log (a long snapshot-less run) lost its individual evictions - drop everything.
  if (world.drainTouched((e) => cache.delete(e))) cache.clear();
  const entities: EntitySnapshot[] = [];
  for (const id of world.canonicalEntities()) {
    const cached = cache.get(id);
    if (cached !== undefined) {
      entities.push(cached);
      continue;
    }
    const snap = cloneEntity(world, id);
    entities.push(snap);
    // Cacheable scenery: these change only at logged moments, unlike a settler whose Position moves every tick.
    if (world.has(id, Resource) || world.has(id, Stump) || world.has(id, BerryBush)) {
      cache.set(id, snap);
    }
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
    const entries = [...value.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries.map(([k, v]) => [clonePlain(k), clonePlain(v)]);
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
