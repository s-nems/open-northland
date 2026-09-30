import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';
import { indexOfEntity } from './snapshot.js';
import type { EntityDelta, SnapshotDelta } from './snapshot-clones.js';
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
      for (const entry of delta.touched) this.entities.push(created(entry));
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
      this.merge(delta.touched);
    }
    this.lastSequence = delta.sequence;
    this.current = { tick: delta.tick, entities: this.entities, events: delta.events };
    attachIndexes(this.current, this.indexes);
  }

  /** Each maintained index that no longer matches a fresh walk of the entities, described
   *  (`SnapshotIndexes.verify`). */
  verifyIndexes(): string[] {
    return this.indexes.verify();
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
  private merge(touched: readonly EntityDelta[]): void {
    const list = this.entities;
    const inserts: EntitySnapshot[] = [];
    for (const entry of touched) {
      const at = indexOfEntity(list, entry.id);
      const held = at >= 0 ? list[at] : undefined;
      if (held !== undefined) {
        const next = patched(held, entry);
        list[at] = next;
        this.indexes.replaced(held, next, entry);
      } else {
        const entity = created(entry);
        inserts.push(entity);
        this.indexes.added(entity);
      }
    }
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

function created(entry: EntityDelta): EntitySnapshot {
  return { id: entry.id, components: entry.components };
}

/** The new object of a held entity: the previous clones of the components the entry left alone, the
 *  entry's fresh clones over them, without the components it removed. */
function patched(held: EntitySnapshot, entry: EntityDelta): EntitySnapshot {
  if (entry.removed.length === 0) {
    return { id: entry.id, components: { ...held.components, ...entry.components } };
  }
  const components: Record<string, unknown> = {};
  for (const name of Object.keys(held.components)) {
    if (!entry.removed.includes(name)) {
      copyComponent(
        components,
        name,
        Object.hasOwn(entry.components, name) ? entry.components[name] : held.components[name],
      );
    }
  }
  for (const name of Object.keys(entry.components)) {
    if (!Object.hasOwn(held.components, name) && !entry.removed.includes(name))
      copyComponent(components, name, entry.components[name]);
  }
  return { id: entry.id, components };
}

function copyComponent(target: Record<string, unknown>, name: string, value: unknown): void {
  // Match object spread's own data property semantics for this inherited setter.
  if (name === '__proto__') {
    Object.defineProperty(target, name, { value, enumerable: true, configurable: true, writable: true });
  } else target[name] = value;
}
