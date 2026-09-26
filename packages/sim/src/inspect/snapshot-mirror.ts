import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';
import { indexOfEntity } from './snapshot.js';
import type { SnapshotDelta } from './snapshot-clones.js';

/**
 * The consumer side of a `SnapshotDeltaStream`: applies each delta to one entity list kept in
 * canonical order and hands out a `WorldSnapshot` over it with the clone cache's identities, so
 * memoisation by snapshot and by entity keeps working as it does on `Simulation.snapshot()`. An
 * untouched entity is the object the previous snapshot held, a touched one is the delta's, and the
 * snapshot object is new per applied delta; the list itself is edited in place, per change.
 */
export class SnapshotMirror {
  private readonly entities: EntitySnapshot[] = [];
  private current: WorldSnapshot | null = null;
  private applied = 0;
  private dropped: EntitySnapshot[] = [];

  /** The tick of the last applied delta; null before the first. */
  get tick(): number | null {
    return this.current?.tick ?? null;
  }

  /** Counts applied deltas: the key for a memo over the mirror's state. */
  get version(): number {
    return this.applied;
  }

  /** The entities the last applied delta removed, ascending by id, as the snapshot before it held them:
   *  the one place a settler reaped in that stretch can still be named. Empty after a rebuild. */
  get departed(): readonly EntitySnapshot[] {
    return this.dropped;
  }

  /** Apply the next delta. Throws on a delta that does not follow the last applied one, since a dropped
   *  delta would leave the mirror silently stale. */
  apply(delta: SnapshotDelta): void {
    this.dropped = [];
    if (delta.rebuild) {
      this.entities.length = 0;
      for (const entity of delta.touched) this.entities.push(entity);
    } else {
      const current = this.current;
      if (current === null) throw new Error('snapshot mirror: the first delta must rebuild');
      if (delta.baseTick !== current.tick) {
        throw new Error(
          `snapshot mirror at tick ${current.tick} refuses a delta from tick ${delta.baseTick}: a delta was skipped`,
        );
      }
      if (delta.tick < current.tick) {
        throw new Error(
          `snapshot mirror at tick ${current.tick} refuses a delta to earlier tick ${delta.tick}`,
        );
      }
      this.drop(delta.removed);
      this.merge(delta.touched);
    }
    this.applied++;
    this.current = { tick: delta.tick, entities: this.entities, events: delta.events };
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
        next++;
        continue;
      }
      list[write++] = entity;
    }
    list.length = write;
  }

  /** Replace the touched entities the list holds in place and merge the new ones in back to front, so
   *  the list grows in place and only the suffix from the first insertion moves. */
  private merge(touched: readonly EntitySnapshot[]): void {
    const list = this.entities;
    const inserts: EntitySnapshot[] = [];
    for (const entity of touched) {
      const at = indexOfEntity(list, entity.id);
      if (at >= 0) list[at] = entity;
      else inserts.push(entity);
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
