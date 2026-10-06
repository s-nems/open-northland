import { addField } from './fast-record.js';
import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';
import { attachIdTable, indexOfEntity, indexOfEntityFrom } from './snapshot.js';
import { changeAt, deltaValues, type EntityChange, type SnapshotDelta } from './snapshot-delta.js';
import { attachIndexes, SnapshotIndexes } from './snapshot-indexes.js';

/**
 * The consumer side of one `SnapshotDeltaStream`: applies each of its deltas to one entity list kept
 * in canonical order and hands out a `WorldSnapshot` over it in its own entity objects, so memoisation
 * by snapshot and by entity keeps working as it does on `Simulation.snapshot()`. An untouched entity is
 * the object the previous snapshot held, a touched one is a new object over the previous clones of the
 * components its entry left alone, and the snapshot object is new per applied delta; the list itself
 * is edited in place, per change. Entries are diffed against what their own stream carried last, so
 * deltas of two streams must not be mixed into one mirror. The same edits feed the `indexesOf` views
 * over its snapshots, so a consumer reads those instead of walking the list per tick.
 */
export class SnapshotMirror {
  private readonly entities: EntitySnapshot[] = [];
  /** The entities indexed by id, kept with the list, which `entityById` answers from in place of a
   *  search. An array store costs a replaced entity far less than a map's hashed set. */
  private readonly byId: (EntitySnapshot | undefined)[] = [];

  constructor() {
    attachIdTable(this.entities, this.byId);
  }
  private readonly indexes = new SnapshotIndexes(() => this.entities);
  private current: WorldSnapshot | null = null;
  private lastSequence = 0;
  private dropped: EntitySnapshot[] = [];

  /** The tick of the last applied delta; null before the first. */
  get tick(): number | null {
    return this.current?.tick ?? null;
  }

  /** The entities the last applied delta removed, ascending by id, as the previous snapshot held them
   *  (a mutation before the death inside the stretch is not seen): the one place a settler reaped in
   *  that stretch can still be named. Empty after a rebuild. */
  get departed(): readonly EntitySnapshot[] {
    return this.dropped;
  }

  /** Apply the next delta. Throws on a non-rebuild delta whose `sequence` does not directly follow the
   *  last applied one, since a dropped delta would leave the mirror silently stale; a rebuild carries the
   *  whole world and sets the base for the deltas after it. */
  apply(delta: SnapshotDelta): void {
    this.dropped = [];
    if (delta.rebuild) {
      this.entities.length = 0;
      this.byId.length = 0;
      const values = deltaValues(delta);
      let at = 0;
      for (let i = 0; i < delta.touched.length; i++) {
        const change = changeAt(delta, i);
        const entity = created(delta.touched[i] as number, change, values, at);
        this.entities.push(entity);
        this.byId[entity.id] = entity;
        at += change.written.length;
      }
      this.indexes.reset();
    } else {
      const current = this.current;
      if (current === null) throw new Error('snapshot mirror: the first delta must rebuild');
      if (delta.sequence !== this.lastSequence + 1) {
        throw new Error(
          `snapshot mirror after delta ${this.lastSequence} refuses delta ${delta.sequence}: a delta was skipped`,
        );
      }
      this.drop(delta.removed);
      this.merge(delta);
    }
    this.lastSequence = delta.sequence;
    this.current = { tick: delta.tick, entities: this.entities, events: delta.events };
    attachIndexes(this.current, this.indexes);
  }

  /** Each maintained index that no longer matches a fresh walk of the entities, described
   *  (`SnapshotIndexes.verify`). */
  verifyIndexes(): string[] {
    const out = this.indexes.verify();
    let held = 0;
    for (const entity of this.byId) if (entity !== undefined) held++;
    let mapped = held === this.entities.length;
    for (const entity of this.entities) if (this.byId[entity.id] !== entity) mapped = false;
    if (!mapped) out.push('the id table differs from the entity list');
    return out;
  }

  /** The snapshot the applied deltas add up to. Throws before the first delta: there is no world yet. */
  snapshot(): WorldSnapshot {
    if (this.current === null) throw new Error('snapshot mirror: no delta applied yet');
    return this.current;
  }

  /** Compact the list over the removed ids, from the first one's place; an id the list does not hold is
   *  an entity created and destroyed inside one delta, and is skipped. */
  private drop(removed: readonly number[]): void {
    const first = removed[0];
    if (first === undefined) return;
    const list = this.entities;
    const found = indexOfEntity(list, first);
    let write = found >= 0 ? found : -found - 1;
    let next = 0;
    for (let read = write; read < list.length; read++) {
      const entity = list[read];
      if (entity === undefined) break; // unreachable: read stays inside the list
      let id = removed[next];
      while (id !== undefined && id < entity.id) id = removed[++next];
      if (id === entity.id) {
        this.dropped.push(entity);
        this.byId[entity.id] = undefined;
        this.indexes.removed(entity);
        next++;
        continue;
      }
      list[write++] = entity;
    }
    list.length = write;
  }

  /** Patch the touched entities the list holds in place and merge the new ones in back to front, so
   *  the list grows in place and only the suffix from the first insertion moves. */
  private merge(delta: SnapshotDelta): void {
    const list = this.entities;
    const inserts: EntitySnapshot[] = [];
    const { touched } = delta;
    const values = deltaValues(delta);
    this.indexes.beginDelta(delta.changes);
    let at = 0;
    let from = 0;
    for (let i = 0; i < touched.length; i++) {
      const id = touched[i] as number;
      const change = changeAt(delta, i);
      const found = indexOfEntityFrom(list, id, from);
      const held = found >= 0 ? list[found] : undefined;
      if (held !== undefined) {
        const next = patched(held, change, values, at);
        list[found] = next;
        this.byId[id] = next;
        this.indexes.replaced(held, next, delta.changeOf[i] as number);
        from = found + 1;
      } else {
        const entity = created(id, change, values, at);
        inserts.push(entity);
        this.byId[id] = entity;
        this.indexes.added(entity);
        from = -found - 1;
      }
      at += change.written.length;
    }
    this.indexes.endDelta();
    if (inserts.length === 0) return;
    let read = list.length - 1;
    for (const entity of inserts) list.push(entity); // placeholders; the merge below overwrites them
    let write = list.length - 1;
    for (let next = inserts.length - 1; next >= 0; ) {
      const insert = inserts[next];
      const held = read >= 0 ? list[read] : undefined;
      if (insert === undefined) break; // unreachable: next stays inside inserts
      if (held !== undefined && held.id > insert.id) {
        list[write--] = held;
        read--;
      } else {
        list[write--] = insert;
        next--;
      }
    }
  }
}

function created(id: number, change: EntityChange, values: readonly unknown[], at: number): EntitySnapshot {
  const components: Record<string, unknown> = {};
  const { written } = change;
  for (let k = 0; k < written.length; k++) addField(components, k, written[k] as string, values[at + k]);
  return { id, components };
}

/** The new object of a held entity: the previous clones of the components the change left alone, the
 *  change's fresh clones over them, without the components it removed. A name the entity did not hold
 *  lands last. */
function patched(
  held: EntitySnapshot,
  change: EntityChange,
  values: readonly unknown[],
  at: number,
): EntitySnapshot {
  const { written, removed } = change;
  let components: Record<string, unknown>;
  let fields = -1; // counted only once a name is added
  if (removed.length === 0) {
    // Object.assign onto an empty literal copies a fast record's shape whole; a spread copies key by key.
    components = Object.assign({}, held.components);
  } else {
    components = {};
    fields = 0;
    for (const name in held.components) {
      if (!removed.includes(name)) addField(components, fields++, name, held.components[name]);
    }
  }
  for (let k = 0; k < written.length; k++) {
    const name = written[k] as string;
    if (name in components) {
      components[name] = values[at + k];
      continue;
    }
    if (fields < 0) fields = fieldCount(components);
    addField(components, fields++, name, values[at + k]);
  }
  return { id: held.id, components };
}

function fieldCount(components: Readonly<Record<string, unknown>>): number {
  let fields = 0;
  for (const _ in components) fields++;
  return fields;
}
