import type { SimEvent } from '../core/events.js';
import { isPlainRecord } from '../core/plain-value.js';
import type { World } from '../ecs/world.js';
import { cloneEvents, snapshotClonesFor } from './snapshot-clones.js';

/**
 * The detached view render and audio read instead of the live component stores, taken after a `step()`
 * completes. Every value is plain data with no class instances or live `Map`s, so a consumer can never
 * reach the live store and the whole structure survives the structured clone algorithm at a worker
 * boundary. Not a save format.
 */
export interface WorldSnapshot {
  readonly tick: number;
  /** One entity per alive id, in canonical (ascending) order. A mirror's snapshots share one list that
   *  the mirror edits in place as deltas apply, so a consumer that keeps a snapshot past the next tick
   *  copies the list; the entity objects themselves never change. */
  readonly entities: readonly EntitySnapshot[];
  /** The one-shot events produced during the tick this snapshot was taken after. */
  readonly events: readonly SimEvent[];
}

export interface EntitySnapshot {
  readonly id: number;
  /** componentName -> a plain-cloned copy of its value (Maps become `[key, value]` arrays). Read by
   *  name: a mirror lists a component added to a held entity last, not in the live walk's order. */
  readonly components: Readonly<Record<string, unknown>>;
}

export interface HomeQualityView {
  readonly cooking: number;
  readonly rest: number;
  readonly piety: number;
}

/** Decode one home's detached quality pools from a snapshot. */
export function homeQualityView(snapshot: WorldSnapshot, home: number): HomeQualityView | null {
  const raw = entityById(snapshot, home)?.components.HomeQuality;
  if (!isPlainRecord(raw)) return null;
  const { cooking, rest, piety } = raw;
  if (typeof cooking !== 'number' || typeof rest !== 'number' || typeof piety !== 'number') return null;
  return { cooking, rest, piety };
}

/**
 * Capture a detached snapshot of the world and the tick's events at a tick boundary. Entities are
 * emitted in canonical ascending-id order and `Map` values become sorted `[key, value]` arrays, the same
 * canonical ordering `hashState` uses. An untouched entity reuses its cached clone object; a touched one
 * receives a new entity object while retaining the detached clones of unchanged components. The list is
 * rebuilt over every alive entity per call; a `SnapshotMirror` fed by `SnapshotDeltaStream` keeps one
 * per change instead.
 */
export function takeSnapshot(world: World, tick: number, events: readonly SimEvent[]): WorldSnapshot {
  const clones = snapshotClonesFor(world);
  clones.refresh();
  const entities: EntitySnapshot[] = [];
  for (const id of world.canonicalEntities()) entities.push(clones.snapOf(id));
  return { tick, entities, events: cloneEvents(events) };
}

/**
 * The snapshot entity with `id`, or `undefined` once it has left the snapshot. Binary search: a narrowed
 * view that re-orders `entities` breaks the ascending-id precondition and must not be passed here.
 */
export function entityById(snapshot: WorldSnapshot, id: number): EntitySnapshot | undefined {
  const at = indexOfEntity(snapshot.entities, id);
  return at >= 0 ? snapshot.entities[at] : undefined;
}

/**
 * Binary search over an ascending-id list: the index of the entity with `id`, or `-(insertion) - 1`
 * where `insertion` is the index it would take, the same encoding as a sorted-array bisect.
 */
export function indexOfEntity(entities: readonly EntitySnapshot[], id: number): number {
  let lo = 0;
  let hi = entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const found = entities[mid];
    if (found === undefined) break; // unreachable: mid is always within bounds
    if (found.id === id) return mid;
    if (found.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -lo - 1;
}

/** {@link indexOfEntity} over the ascending list from index `from` on, for ids looked up in ascending
 *  order: it gallops from `from`, so a run of nearby ids costs a few probes each. */
export function indexOfEntityFrom(list: readonly EntitySnapshot[], id: number, from: number): number {
  let lo = from;
  let step = 1;
  let hi = from;
  while (hi < list.length && (list[hi] as EntitySnapshot).id < id) {
    lo = hi + 1;
    hi = from + step;
    step *= 2;
  }
  hi = Math.min(hi, list.length - 1);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const found = list[mid] as EntitySnapshot;
    if (found.id === id) return mid;
    if (found.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -lo - 1;
}
