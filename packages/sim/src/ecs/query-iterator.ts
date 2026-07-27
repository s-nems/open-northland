import type { Component, Entity } from './component.js';

/**
 * Walks the smallest required store, yielding the entities present in every other required store. Reusing
 * one {@link result} object (rather than a generator's fresh `{value, done}` per entity) is safe because the
 * for-of / spread protocol reads `.value` before the next `next()` call, so no stale id escapes the loop.
 */
export class QueryIterator implements IterableIterator<Entity> {
  private readonly result: IteratorResult<Entity> = { done: false, value: 0 as Entity };
  private readonly stores: Array<Map<Entity, unknown>> = [];
  private readonly smallest: Map<Entity, unknown> | null;
  private keys: Iterator<Entity> | null;

  constructor(
    all: ReadonlyMap<Component<unknown>, Map<Entity, unknown>>,
    required: ReadonlyArray<Component<unknown>>,
  ) {
    let smallest: Map<Entity, unknown> | undefined;
    let resolvable = required.length > 0;
    for (const c of required) {
      const s = all.get(c);
      if (s === undefined) {
        resolvable = false;
        break;
      }
      this.stores.push(s);
      if (smallest === undefined || s.size < smallest.size) smallest = s;
    }
    if (!resolvable || smallest === undefined) {
      this.smallest = null;
      this.keys = null;
    } else {
      this.smallest = smallest;
      this.keys = smallest.keys();
    }
  }

  next(): IteratorResult<Entity> {
    const keys = this.keys;
    if (keys === null) return this.finish();
    const smallest = this.smallest;
    for (;;) {
      const step = keys.next();
      if (step.done === true) return this.finish();
      const id = step.value;
      let match = true;
      for (const s of this.stores) {
        if (s !== smallest && !s.has(id)) {
          match = false;
          break;
        }
      }
      if (match) {
        this.result.value = id;
        return this.result;
      }
    }
  }

  private finish(): IteratorResult<Entity> {
    this.keys = null;
    this.result.done = true;
    // The protocol ignores `value` once `done` is true, so the last yielded id is left in place.
    return this.result;
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this;
  }
}
