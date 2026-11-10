import type { Component, Entity } from './component.js';
import { type ComponentStore, VACANT_SLOT } from './component-store.js';

/**
 * Walks the smallest required store, yielding the entities present in every other required store. The
 * iterator is its own result (rather than a generator's fresh `{value, done}` per entity), which is safe
 * because the for-of / spread protocol reads `.value` before the next `next()` call, so no stale id
 * escapes the loop. Like a `Map` iterator it sees members added during the walk and skips removed ones.
 */
export class QueryIterator implements IterableIterator<Entity> {
  done = false;
  value = 0 as Entity;
  /** The required stores other than {@link walked}, probed per candidate. */
  private others = NO_OTHERS;
  private walked: ComponentStore<unknown> | null = null;
  private slot = 0;
  /** The walked store's {@link ComponentStore.epoch} that {@link slot} indexes into. */
  private epoch = 0;
  /** Insertion sequence of the last yielded slot, the resume point after a compaction. */
  private lastSeq = -1;

  constructor(
    storesById: ReadonlyArray<ComponentStore<unknown> | undefined>,
    required: ReadonlyArray<Component<unknown>>,
  ) {
    let smallest: ComponentStore<unknown> | undefined;
    for (let i = 0; i < required.length; i++) {
      const s = storesById[(required[i] as Component<unknown>).id];
      if (s === undefined) return;
      if (smallest === undefined || s.size < smallest.size) smallest = s;
    }
    if (smallest === undefined) return;
    if (required.length > 1) {
      const others: Array<ComponentStore<unknown>> = [];
      for (let i = 0; i < required.length; i++) {
        const s = storesById[(required[i] as Component<unknown>).id];
        if (s !== undefined && s !== smallest) others.push(s);
      }
      this.others = others;
    }
    this.walked = smallest;
    this.epoch = smallest.epoch;
  }

  next(): IteratorResult<Entity> {
    const store = this.walked;
    if (store === null) return this.finish();
    let slot = this.slot;
    if (store.epoch !== this.epoch) {
      slot = store.firstSlotAfter(this.lastSeq);
      this.epoch = store.epoch;
    }
    // Re-read per call: a store grows by reallocating its dense arrays.
    const entities = store.entities;
    const others = this.others;
    const end = store.length;
    while (slot < end) {
      const id = entities[slot++] ?? VACANT_SLOT;
      if (id === VACANT_SLOT) continue;
      let match = true;
      for (let i = 0; i < others.length; i++) {
        if (others[i]?.has(id as Entity) !== true) {
          match = false;
          break;
        }
      }
      if (match) {
        this.slot = slot;
        this.lastSeq = store.seqs[slot - 1] ?? 0;
        this.value = id as Entity;
        return this as IteratorResult<Entity>;
      }
    }
    return this.finish();
  }

  private finish(): IteratorResult<Entity> {
    this.walked = null;
    this.done = true;
    // The protocol ignores `value` once `done` is true, so the last yielded id is left in place.
    return this as IteratorResult<Entity>;
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this;
  }
}

const NO_OTHERS: ReadonlyArray<ComponentStore<unknown>> = [];
