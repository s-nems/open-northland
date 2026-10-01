import type { Component, Entity } from './component.js';

/**
 * Walks the smallest required store, yielding the entities present in every other required store. Reusing
 * one {@link result} object (rather than a generator's fresh `{value, done}` per entity) is safe because the
 * for-of / spread protocol reads `.value` before the next `next()` call, so no stale id escapes the loop.
 */
export class QueryIterator implements IterableIterator<Entity> {
  private readonly result: IteratorResult<Entity> = { done: false, value: 0 as Entity };
  /** The required stores other than {@link smallest}, probed per candidate. */
  private readonly others: Array<Map<Entity, unknown>> = [];
  private keys: Iterator<Entity> | null = null;

  constructor(
    storesById: ReadonlyArray<Map<Entity, unknown> | undefined>,
    required: ReadonlyArray<Component<unknown>>,
  ) {
    let smallest: Map<Entity, unknown> | undefined;
    for (const c of required) {
      const s = storesById[c.id];
      if (s === undefined) return;
      if (smallest === undefined || s.size < smallest.size) smallest = s;
    }
    if (smallest === undefined) return;
    for (const c of required) {
      const s = storesById[c.id];
      if (s !== undefined && s !== smallest) this.others.push(s);
    }
    this.keys = smallest.keys();
  }

  next(): IteratorResult<Entity> {
    const keys = this.keys;
    if (keys === null) return this.finish();
    const others = this.others;
    for (;;) {
      const step = keys.next();
      if (step.done === true) return this.finish();
      const id = step.value;
      let match = true;
      for (let i = 0; i < others.length; i++) {
        if (others[i]?.has(id) !== true) {
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
