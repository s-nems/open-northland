import { ONE } from '../core/fixed.js';
import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';
import { indexOfEntity } from './snapshot.js';
import type { EntityDelta } from './snapshot-clones.js';
import { type TileBox, TileBuckets } from './tile-buckets.js';

/** The components a spec places an entity by. */
export interface SnapshotIndexReads {
  /** Components whose value the placement reads. */
  readonly values?: readonly string[];
  /** Components whose presence alone the placement reads, so a rewrite of one leaves it alone. */
  readonly presence?: readonly string[];
}

/**
 * One view over a snapshot's entities kept up to date per change: a mirror feeds it the entities each
 * delta added, removed or replaced, so a consumer reads the view instead of walking the entity list per
 * tick. Hold a spec as a module constant; the state lives under the spec object's identity.
 */
export interface SnapshotIndexSpec<T> {
  /** What a diagnostic calls the index. */
  readonly name?: string;
  /** Everything `add` and `remove` read. With it, a touched entity that wrote, added and removed none
   *  of them skips `replace` and goes to `swap`; a missing name leaves the state stale. */
  readonly reads?: SnapshotIndexReads;
  empty(): T;
  add(state: T, entity: EntitySnapshot): void;
  remove(state: T, entity: EntitySnapshot): void;
  /** The new object of a touched entity the snapshot already held; defaults to remove then add. */
  replace?(state: T, previous: EntitySnapshot, next: EntitySnapshot): void;
  /** The new object of a touched entity whose `reads` it left alone, for a state that hands out entity
   *  objects; without it the entity costs the state nothing. */
  swap?(state: T, previous: EntitySnapshot, next: EntitySnapshot): void;
  /** Where a maintained state says something a fresh walk (`fresh`) does not, or null; defaults to
   *  {@link firstDifference}. A state holding read-through caches or an order its history set compares
   *  what its readers see; `current` reads the other specs fresh over the same entities. */
  differs?(held: T, fresh: T, current: SnapshotIndexReader): string | null;
}

/** The read side of a snapshot's indexes: the state of `spec` over the snapshot's current entities. */
export interface SnapshotIndexReader {
  get<T>(spec: SnapshotIndexSpec<T>): T;
}

type Replacement = (state: unknown, previous: EntitySnapshot, next: EntitySnapshot) => void;

/** A held state with its spec's upkeep resolved once, one shape for every spec: the per-change loop
 *  reads these fields for every held index and every touched entity. */
interface HeldIndex {
  readonly spec: SnapshotIndexSpec<unknown>;
  readonly state: unknown;
  readonly gated: boolean;
  readonly replace: Replacement;
  readonly swap: Replacement | null;
  /** The last change that touched something the spec reads. */
  marked: number;
}

function heldIndex(spec: SnapshotIndexSpec<unknown>, state: unknown): HeldIndex {
  return {
    spec,
    state,
    gated: spec.reads !== undefined,
    replace:
      spec.replace?.bind(spec) ??
      ((held, previous, next) => {
        spec.remove(held, previous);
        spec.add(held, next);
      }),
    swap: spec.swap?.bind(spec) ?? null,
    marked: 0,
  };
}

/**
 * The index states over one snapshot lineage. A state is built on first request by one walk over the
 * current entities and maintained from the changes after that; a rebuilt mirror drops every state so the
 * next request walks the new list.
 */
export class SnapshotIndexes implements SnapshotIndexReader {
  private readonly held = new Map<SnapshotIndexSpec<unknown>, HeldIndex>();
  private readonly order: HeldIndex[] = [];
  private readonly valueReaders = new Map<string, HeldIndex[]>();
  private readonly presenceReaders = new Map<string, HeldIndex[]>();
  private changes = 0;

  constructor(private readonly entities: () => readonly EntitySnapshot[]) {}

  /** A spec is maintained per delta from its first request until a rebuild drops it, so one first read
   *  by a rare caller (a click) keeps its upkeep cost for the rest of the session. */
  get<T>(spec: SnapshotIndexSpec<T>): T {
    const cached = this.held.get(spec as SnapshotIndexSpec<unknown>);
    if (cached !== undefined) return cached.state as T;
    const state = spec.empty();
    for (const entity of this.entities()) spec.add(state, entity);
    const index = heldIndex(spec as SnapshotIndexSpec<unknown>, state);
    this.held.set(index.spec, index);
    this.order.push(index);
    for (const name of spec.reads?.values ?? []) listUnder(this.valueReaders, name).push(index);
    for (const name of spec.reads?.presence ?? []) listUnder(this.presenceReaders, name).push(index);
    return state;
  }

  reset(): void {
    this.held.clear();
    this.order.length = 0;
    this.valueReaders.clear();
    this.presenceReaders.clear();
  }

  /** Each held state that no longer matches a fresh walk of the current entities, described: a
   *  diagnostic that costs a first read of every held spec. */
  verify(): string[] {
    const current = new SnapshotIndexes(this.entities);
    const out: string[] = [];
    for (const { spec, state: held } of this.order) {
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
    for (const { spec, state } of this.order) spec.add(state, entity);
  }

  removed(entity: EntitySnapshot): void {
    for (const { spec, state } of this.order) spec.remove(state, entity);
  }

  /** `next` replaces `previous` after `change`, which names what the entity wrote and removed. */
  replaced(previous: EntitySnapshot, next: EntitySnapshot, change: EntityDelta): void {
    const mark = ++this.changes;
    for (const name in change.components) {
      markAll(this.valueReaders.get(name), mark);
      const testers = this.presenceReaders.get(name);
      if (testers !== undefined && !(name in previous.components)) markAll(testers, mark);
    }
    for (const name of change.removed) {
      markAll(this.valueReaders.get(name), mark);
      markAll(this.presenceReaders.get(name), mark);
    }
    for (const index of this.order) {
      if (!index.gated || index.marked === mark) index.replace(index.state, previous, next);
      else if (index.swap !== null) index.swap(index.state, previous, next);
    }
  }
}

function listUnder(readers: Map<string, HeldIndex[]>, name: string): HeldIndex[] {
  let list = readers.get(name);
  if (list === undefined) {
    list = [];
    readers.set(name, list);
  }
  return list;
}

function markAll(indexes: readonly HeldIndex[] | undefined, mark: number): void {
  if (indexes === undefined) return;
  for (const index of indexes) index.marked = mark;
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

// The generic views most consumers compose. Each takes the `reads` its function places an entity by.

/** The entities `matches` accepts, ascending by id like the snapshot's own list. A held entity is found
 *  by id, so only the new object meets `matches` again. */
export function listedWhere(
  matches: (entity: EntitySnapshot) => boolean,
  name?: string,
  reads?: SnapshotIndexReads,
): SnapshotIndexSpec<EntitySnapshot[]> {
  return {
    ...(name === undefined ? {} : { name }),
    ...(reads === undefined ? {} : { reads }),
    empty: () => [],
    add: (list, entity) => {
      if (matches(entity)) insertSorted(list, entity);
    },
    remove: (list, entity) => {
      removeSorted(list, entity.id);
    },
    replace: (list, _previous, next) => {
      const at = indexOfEntity(list, next.id);
      if (matches(next)) {
        if (at >= 0) list[at] = next;
        else list.splice(-at - 1, 0, next);
      } else if (at >= 0) {
        list.splice(at, 1);
      }
    },
    swap: (list, _previous, next) => swapHeld(list, next),
  };
}

const BY_COMPONENT = new Map<string, SnapshotIndexSpec<EntitySnapshot[]>>();

/** The entities carrying component `name`, ascending by id; one shared spec per name. */
export function withComponent(name: string): SnapshotIndexSpec<EntitySnapshot[]> {
  let spec = BY_COMPONENT.get(name);
  if (spec === undefined) {
    spec = listedWhere((entity) => Object.hasOwn(entity.components, name), `withComponent(${name})`, {
      presence: [name],
    });
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
  reads?: SnapshotIndexReads,
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
    ...(reads === undefined ? {} : { reads }),
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

/** Entity lists by key, each ascending by id, with the key each held entity sits under so a change
 *  finds its group without reading the entity again. */
export class EntityGroups extends Map<number, EntitySnapshot[]> {
  readonly keyOfId = new Map<number, number>();
}

/** The entities under each key, each list ascending by id; a key with no entity left is absent. */
export function groupedBy(
  keyOf: (entity: EntitySnapshot) => number | undefined,
  name?: string,
  reads?: SnapshotIndexReads,
): SnapshotIndexSpec<EntityGroups> {
  const add = (groups: EntityGroups, entity: EntitySnapshot): void => {
    const key = keyOf(entity);
    if (key === undefined) return;
    groups.keyOfId.set(entity.id, key);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entity]);
    else insertSorted(group, entity);
  };
  const remove = (groups: EntityGroups, id: number): void => {
    const key = groups.keyOfId.get(id);
    if (key === undefined) return;
    groups.keyOfId.delete(id);
    const group = groups.get(key);
    if (group === undefined) return;
    removeSorted(group, id);
    if (group.length === 0) groups.delete(key);
  };
  return {
    ...(name === undefined ? {} : { name }),
    ...(reads === undefined ? {} : { reads }),
    empty: () => new EntityGroups(),
    add,
    remove: (groups, entity) => remove(groups, entity.id),
    replace: (groups, _previous, next) => {
      const key = keyOf(next);
      const group = key === undefined ? undefined : groups.get(key);
      if (group !== undefined && groups.keyOfId.get(next.id) === key) {
        replaceSorted(group, next);
        return;
      }
      remove(groups, next.id);
      add(groups, next);
    },
    swap: (groups, _previous, next) => {
      const key = groups.keyOfId.get(next.id);
      const group = key === undefined ? undefined : groups.get(key);
      if (group !== undefined) swapHeld(group, next);
    },
    differs: (held, fresh) =>
      firstDifference(held, fresh) ?? firstDifference(held.keyOfId, fresh.keyOfId, 'the keys'),
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
  reads: { values: ['Position'] },
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
    const tile = tileOf(next);
    if (tile === null) buckets.delete(previous.id);
    else buckets.set(next.id, next, tile.x, tile.y);
  },
  swap: (buckets, _previous, next) => {
    buckets.replace(next.id, next);
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

/** Put `entity` in its predecessor's slot, when the list holds it. */
function swapHeld(list: EntitySnapshot[], entity: EntitySnapshot): void {
  const at = indexOfEntity(list, entity.id);
  if (at >= 0) list[at] = entity;
}

function removeSorted(list: EntitySnapshot[], id: number): void {
  const at = indexOfEntity(list, id);
  if (at >= 0) list.splice(at, 1);
}
