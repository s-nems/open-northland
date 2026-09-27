import { ONE } from '../core/fixed.js';
import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';
import { indexOfEntity } from './snapshot.js';
import { type TileBox, TileBuckets } from './tile-buckets.js';

/**
 * One view over a snapshot's entities kept up to date per change: a mirror feeds it the entities each
 * delta added, removed or replaced, so a consumer reads the view instead of walking the entity list per
 * tick. Hold a spec as a module constant; the state lives under the spec object's identity.
 */
export interface SnapshotIndexSpec<T> {
  /** What a diagnostic calls the index. */
  readonly name?: string;
  empty(): T;
  add(state: T, entity: EntitySnapshot): void;
  remove(state: T, entity: EntitySnapshot): void;
  /** The new object of a touched entity the snapshot already held; defaults to remove then add. */
  replace?(state: T, previous: EntitySnapshot, next: EntitySnapshot): void;
  /** Where a maintained state says something a fresh walk (`fresh`) does not, or null; defaults to
   *  {@link firstDifference}. A state holding read-through caches or an order its history set compares
   *  what its readers see; `current` reads the other specs fresh over the same entities. */
  differs?(held: T, fresh: T, current: SnapshotIndexReader): string | null;
}

/** The read side of a snapshot's indexes: the state of `spec` over the snapshot's current entities. */
export interface SnapshotIndexReader {
  get<T>(spec: SnapshotIndexSpec<T>): T;
}

/**
 * The index states over one snapshot lineage. A state is built on first request by one walk over the
 * current entities and maintained from the changes after that; a rebuilt mirror drops every state so the
 * next request walks the new list.
 */
export class SnapshotIndexes implements SnapshotIndexReader {
  private readonly held = new Map<SnapshotIndexSpec<unknown>, unknown>();

  constructor(private readonly entities: () => readonly EntitySnapshot[]) {}

  /** A spec is maintained per delta from its first request until a rebuild drops it, so one first read
   *  by a rare caller (a click) keeps its upkeep cost for the rest of the session. */
  get<T>(spec: SnapshotIndexSpec<T>): T {
    const cached = this.held.get(spec as SnapshotIndexSpec<unknown>);
    if (cached !== undefined) return cached as T;
    const state = spec.empty();
    for (const entity of this.entities()) spec.add(state, entity);
    this.held.set(spec as SnapshotIndexSpec<unknown>, state);
    return state;
  }

  reset(): void {
    this.held.clear();
  }

  /** Each held state that no longer matches a fresh walk of the current entities, described: a
   *  diagnostic that costs a first read of every held spec. */
  verify(): string[] {
    const current = new SnapshotIndexes(this.entities);
    const out: string[] = [];
    for (const [spec, held] of this.held) {
      const fresh = current.get(spec);
      const where =
        spec.differs === undefined ? firstDifference(held, fresh) : spec.differs(held, fresh, current);
      if (where !== null) {
        out.push(`the ${spec.name ?? describe(held)} index differs from a fresh walk at ${where}`);
      }
    }
    return out;
  }

  added(entity: EntitySnapshot): void {
    for (const [spec, state] of this.held) spec.add(state, entity);
  }

  removed(entity: EntitySnapshot): void {
    for (const [spec, state] of this.held) spec.remove(state, entity);
  }

  replaced(previous: EntitySnapshot, next: EntitySnapshot): void {
    for (const [spec, state] of this.held) {
      if (spec.replace !== undefined) {
        spec.replace(state, previous, next);
      } else {
        spec.remove(state, previous);
        spec.add(state, next);
      }
    }
  }
}

const INDEXES = new WeakMap<WorldSnapshot, SnapshotIndexes>();

/**
 * The indexes over `snapshot`: the ones its mirror maintains per delta, or, for a snapshot taken
 * straight off a `Simulation`, a set built over its entity list on first request. A mirror's snapshots
 * share one set, so an index read off an older snapshot object answers for the mirror's current one.
 */
export function indexesOf(snapshot: WorldSnapshot): SnapshotIndexReader {
  let indexes = INDEXES.get(snapshot);
  if (indexes === undefined) {
    indexes = new SnapshotIndexes(() => snapshot.entities);
    INDEXES.set(snapshot, indexes);
  }
  return indexes;
}

/** Bind the set a mirror maintains to the snapshot it just produced. */
export function attachIndexes(snapshot: WorldSnapshot, indexes: SnapshotIndexes): void {
  INDEXES.set(snapshot, indexes);
}

/** The path to the first place two plain index states differ, or null when they agree. Arrays compare
 *  in order, `Map`s and `Set`s by key, other objects by own keys under one prototype. */
export function firstDifference(a: unknown, b: unknown, path = 'the root'): string | null {
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return path;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return path;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path} (length ${a.length} against ${b.length})`;
    for (let i = 0; i < a.length; i++) {
      const where = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (where !== null) return where;
    }
    return null;
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return `${path} (size ${a.size} against ${b.size})`;
    for (const [key, value] of a) {
      if (!b.has(key)) return `${path} key ${String(key)}`;
      const where = firstDifference(value, b.get(key), `${path} key ${String(key)}`);
      if (where !== null) return where;
    }
    return null;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return `${path} (size ${a.size} against ${b.size})`;
    for (const item of a) if (!b.has(item)) return `${path} item ${String(item)}`;
    return null;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return `${path} (keys)`;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return `${path}.${key}`;
    const where = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
    if (where !== null) return where;
  }
  return null;
}

function describe(state: unknown): string {
  if (Array.isArray(state)) return `list of ${state.length}`;
  if (state instanceof Map || state instanceof Set) return `${state.constructor.name} of ${state.size}`;
  return typeof state === 'object' && state !== null ? state.constructor.name : typeof state;
}

// The generic views most consumers compose.

/** The entities `matches` accepts, ascending by id like the snapshot's own list. */
export function listedWhere(
  matches: (entity: EntitySnapshot) => boolean,
  name?: string,
): SnapshotIndexSpec<EntitySnapshot[]> {
  return {
    ...(name === undefined ? {} : { name }),
    empty: () => [],
    add: (list, entity) => {
      if (matches(entity)) insertSorted(list, entity);
    },
    remove: (list, entity) => {
      if (matches(entity)) removeSorted(list, entity.id);
    },
    replace: (list, previous, next) => {
      const was = matches(previous);
      const is = matches(next);
      if (was && is) replaceSorted(list, next);
      else if (was) removeSorted(list, previous.id);
      else if (is) insertSorted(list, next);
    },
  };
}

const BY_COMPONENT = new Map<string, SnapshotIndexSpec<EntitySnapshot[]>>();

/** The entities carrying component `name`, ascending by id; one shared spec per name. */
export function withComponent(name: string): SnapshotIndexSpec<EntitySnapshot[]> {
  let spec = BY_COMPONENT.get(name);
  if (spec === undefined) {
    spec = listedWhere((entity) => Object.hasOwn(entity.components, name), `withComponent(${name})`);
    BY_COMPONENT.set(name, spec);
  }
  return spec;
}

export function entitiesWith(snapshot: WorldSnapshot, name: string): readonly EntitySnapshot[] {
  return indexesOf(snapshot).get(withComponent(name));
}

/** How many entities map to each key; a key with no entity left is absent, not zero. */
export function countedBy(
  keyOf: (entity: EntitySnapshot) => number | undefined,
  name?: string,
): SnapshotIndexSpec<Map<number, number>> {
  const add = (counts: Map<number, number>, entity: EntitySnapshot): void => {
    const key = keyOf(entity);
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const remove = (counts: Map<number, number>, entity: EntitySnapshot): void => {
    const key = keyOf(entity);
    if (key === undefined) return;
    const left = (counts.get(key) ?? 0) - 1;
    if (left > 0) counts.set(key, left);
    else counts.delete(key);
  };
  return {
    ...(name === undefined ? {} : { name }),
    empty: () => new Map(),
    add,
    remove,
    replace: (counts, previous, next) => {
      if (keyOf(previous) === keyOf(next)) return;
      remove(counts, previous);
      add(counts, next);
    },
  };
}

/** The entities under each key, each list ascending by id; a key with no entity left is absent. */
export function groupedBy(
  keyOf: (entity: EntitySnapshot) => number | undefined,
  name?: string,
): SnapshotIndexSpec<Map<number, EntitySnapshot[]>> {
  const add = (groups: Map<number, EntitySnapshot[]>, entity: EntitySnapshot): void => {
    const key = keyOf(entity);
    if (key === undefined) return;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entity]);
    else insertSorted(group, entity);
  };
  const remove = (groups: Map<number, EntitySnapshot[]>, entity: EntitySnapshot): void => {
    const key = keyOf(entity);
    if (key === undefined) return;
    const group = groups.get(key);
    if (group === undefined) return;
    removeSorted(group, entity.id);
    if (group.length === 0) groups.delete(key);
  };
  return {
    ...(name === undefined ? {} : { name }),
    empty: () => new Map(),
    add,
    remove,
    replace: (groups, previous, next) => {
      const key = keyOf(next);
      if (key !== undefined && keyOf(previous) === key) {
        const group = groups.get(key);
        if (group !== undefined) replaceSorted(group, next);
        return;
      }
      remove(groups, previous);
      add(groups, next);
    },
  };
}

/** The snapshot's `Position` as tile coordinates, or null for an unpositioned entity. */
function tileOf(entity: EntitySnapshot): { x: number; y: number } | null {
  const pos = entity.components.Position as { x?: unknown; y?: unknown } | undefined;
  if (pos === undefined || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  return { x: pos.x / ONE, y: pos.y / ONE };
}

/** Every positioned entity bucketed by its `Position`, in fractional tile units. */
const BY_POSITION: SnapshotIndexSpec<TileBuckets<EntitySnapshot>> = {
  name: 'position buckets',
  empty: () => new TileBuckets(),
  differs: (held, fresh) => held.differenceFrom(fresh),
  add: (buckets, entity) => {
    const tile = tileOf(entity);
    if (tile !== null) buckets.set(entity.id, entity, tile.x, tile.y);
  },
  remove: (buckets, entity) => {
    buckets.delete(entity.id);
  },
  replace: (buckets, previous, next) => {
    // An unwritten component keeps its clone object across deltas, so an unmoved entity only swaps.
    if (previous.components.Position === next.components.Position) {
      buckets.replace(next.id, next);
      return;
    }
    const tile = tileOf(next);
    if (tile === null) buckets.delete(previous.id);
    else buckets.set(next.id, next, tile.x, tile.y);
  },
};

/**
 * The positioned entities whose `Position` may fall inside `box` (tile units, inclusive): a superset by
 * up to one bucket per side, in arbitrary order, appended to `out`. The caller tests each entity's own
 * position and restores the order it needs.
 */
export function positionedWithin(
  snapshot: WorldSnapshot,
  box: TileBox,
  out: EntitySnapshot[] = [],
): EntitySnapshot[] {
  return indexesOf(snapshot).get(BY_POSITION).within(box, out);
}

/** Whether the snapshot holds entity `id` with a `Position`. */
export function isPositioned(snapshot: WorldSnapshot, id: number): boolean {
  return indexesOf(snapshot).get(BY_POSITION).has(id);
}

function insertSorted(list: EntitySnapshot[], entity: EntitySnapshot): void {
  const at = indexOfEntity(list, entity.id);
  if (at >= 0) list[at] = entity;
  else list.splice(-at - 1, 0, entity);
}

function replaceSorted(list: EntitySnapshot[], entity: EntitySnapshot): void {
  const at = indexOfEntity(list, entity.id);
  if (at >= 0) list[at] = entity;
  else list.splice(-at - 1, 0, entity); // unreachable for a held entity; keeps the list whole regardless
}

function removeSorted(list: EntitySnapshot[], id: number): void {
  const at = indexOfEntity(list, id);
  if (at >= 0) list.splice(at, 1);
}
