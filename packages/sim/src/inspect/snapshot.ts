import { BerryBush, Resource, Stump } from '../components/economy.js';
import type { SimEvent } from '../core/events.js';
import type { Entity, World } from '../ecs/world.js';

/**
 * A read-only snapshot of the world at a tick boundary — the seam `render`/audio read instead of
 * the live component stores. Taken AFTER a `step()` completes (never mid-mutation), it is a plain,
 * structurally-cloned value: no class instances, no live `Map`s, no `Entity` brands — every
 * component value is JSON-ish data. That has two payoffs the plan calls for:
 *
 *  1. **Render never reads mid-mutation.** `render` consumes a frozen snapshot + the tick's events,
 *     so a system writing a component store can't be observed half-applied. (The double-buffer
 *     alternative would keep two live worlds; a cloned snapshot is simpler and, because it's plain,
 *     also gives us...)
 *  2. **Transferable for free.** A plain structure with no class instances / live Maps can be
 *     `postMessage`d to a render thread (the "run the sim in a Web Worker" cross-cutting win) without
 *     a serialization retrofit later.
 *
 * It is NOT the save format — that is the command log (replay-from-seed). This is a per-frame view.
 * Determinism is unaffected: a snapshot is a pure function of the world, never read back into sim
 * logic (it's read-only, and the events are the existing one-shot buffer, not a callback seam).
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
 * Per-world cache of SCENERY entities' cloned {@link EntitySnapshot}s — a decoded map plants tens of
 * thousands of {@link Resource} nodes that then sit unchanged for thousands of ticks, and deep-cloning
 * them every snapshot was the 28 ms/frame that pinned a real map at ~20 fps (golden rule 6: per-frame
 * cost scales with active work). An entry is reused verbatim until the World's touched-entity log names
 * its entity (any `add`/`remove`/`destroy`, or an in-place write the mutating system `touch`es — the
 * harvest decrements). Only entities carrying {@link Resource} or {@link Stump} are cached: their
 * mutation sites are few and named, unlike a settler whose Position mutates in place every tick.
 * Coherence is enforced by a {@link World.registerCacheVerifier} verifier (a fresh re-clone must equal
 * every cached entry), so a future un-`touch`ed mutation fails invariant-checked runs at the tick it
 * happens instead of shipping a stale render.
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
  for (const [name, value] of world.componentEntries(id)) {
    components[name] = clonePlain(value);
  }
  return { id: id as number, components };
}

function verifySceneryClones(world: World, cache: ReadonlyMap<Entity, EntitySnapshot>): string[] {
  const out: string[] = [];
  for (const [id, cached] of cache) {
    if (!world.isAlive(id)) continue; // evicted lazily on the next drain — absence is not incoherence
    const fresh = cloneEntity(world, id);
    if (JSON.stringify(fresh.components) !== JSON.stringify(cached.components)) {
      out.push(`snapshot scenery clone of entity ${id} is stale — an in-place mutation missed World.touch`);
    }
  }
  return out;
}

/**
 * Capture an immutable snapshot of the world (+ the tick's events) at a tick boundary. Entities are
 * emitted in canonical ascending-id order; component values are deep-cloned to plain data so the
 * snapshot can't alias (and so a consumer mutating it can't reach the live store). A `Map` value is
 * converted to a sorted `[key, value]` array — the same canonical ordering `hashState` uses — so the
 * snapshot stays plain (transferable) and deterministic.
 *
 * Unchanged SCENERY entities (see {@link sceneryClones}) reuse their previously-cloned snapshot object
 * — same plain data, shared identity across snapshots — so a map's standing forests cost O(changed)
 * per snapshot, not O(map). Draining the World's touched log here also evicts entries of destroyed
 * entities, so the cache never outgrows the alive scenery set by more than one drain interval.
 */
export function takeSnapshot(world: World, tick: number, events: readonly SimEvent[]): WorldSnapshot {
  const cache = sceneryCloneCache(world);
  // An overflowed log (a long snapshot-less run) lost its individual evictions — drop everything.
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
    // BerryBush joins Resource/Stump as cached scenery: a ripe bush sits unchanged for its whole regrow
    // cycle, so it is re-cloned only at the two `touch`ed moments it flips (foraged, regrown) — not every
    // frame like a moving settler. `ripeAtTick` is an absolute schedule, so a regrowing bush doesn't churn.
    if (Resource.store.has(id) || Stump.store.has(id) || BerryBush.store.has(id)) cache.set(id, snap);
  }
  return { tick, entities, events: events.map(clonePlain) as readonly SimEvent[] };
}

/** Deep-clone a value to plain data: Maps -> sorted [k,v] arrays, arrays/objects recursed, scalars as-is. */
function clonePlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Map) {
    const entries = [...value.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries.map(([k, v]) => [k, clonePlain(v)]) as unknown as T;
  }
  if (Array.isArray(value)) return value.map(clonePlain) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as object).sort()) {
    out[k] = clonePlain((value as Record<string, unknown>)[k]);
  }
  return out as T;
}
