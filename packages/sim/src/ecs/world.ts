/**
 * A tiny, explicit ECS. Deliberately not a library: we need full control over iteration order
 * (for determinism) and maximum legibility. ~180 lines is the whole thing.
 *
 * Rules (see docs/ECS.md):
 *  - Entities are integer ids from a MONOTONIC counter — never recycled. Entities are cheap; id
 *    reuse would make iteration order history-dependent in confusing ways. Don't recycle.
 *  - Components are plain data registered via defineComponent.
 *  - Queries iterate in DETERMINISTIC insertion order of the driving store (no per-call sort — that
 *    was a perf trap at thousands of entities). Order is reproducible across identical runs, which
 *    is what determinism requires. For a CANONICAL order (snapshots/hashes) sort ids explicitly.
 *  - Components carry no behavior; Systems (plain functions) carry all behavior.
 */

import type { Brand } from '../core/brand.js';

/** A branded entity id — a raw number can't be passed where an Entity is expected. */
export type Entity = Brand<number, 'Entity'>;

export interface Component<T> {
  readonly name: string;
  /** internal: dense store keyed by entity id. */
  readonly store: Map<Entity, T>;
}

export function defineComponent<T>(name: string): Component<T> {
  return { name, store: new Map<Entity, T>() };
}

export class World {
  private nextId = 1;
  private readonly alive = new Set<Entity>();
  /** Components in first-registration order — stable, used for canonical hashing/snapshots. */
  private readonly registered: Array<Component<unknown>> = [];
  /**
   * Memoized ascending-id list from {@link canonicalEntities}, rebuilt lazily and invalidated only when
   * the alive set changes ({@link create}/{@link destroy}). Without it, a system that scans the world
   * per entity (job assignment, AI target-finding) re-`[...alive].sort()`s every call — `O(n)` sorts of
   * an `O(n)` list = the quadratic stall that pinned a few-thousand-unit crowd at ~1 fps. Membership is
   * unaffected by component add/remove, so only birth/death dirties it.
   */
  private canonicalCache: Entity[] | null = null;

  create(): Entity {
    const id = this.nextId++ as Entity;
    this.alive.add(id);
    this.canonicalCache = null;
    return id;
  }

  destroy(entity: Entity): void {
    for (const c of this.registered) c.store.delete(entity);
    this.alive.delete(entity);
    this.canonicalCache = null;
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  add<T>(entity: Entity, component: Component<T>, value: T): T {
    if (!this.registered.includes(component as Component<unknown>)) {
      this.registered.push(component as Component<unknown>);
    }
    component.store.set(entity, value);
    return value;
  }

  remove<T>(entity: Entity, component: Component<T>): void {
    component.store.delete(entity);
  }

  has<T>(entity: Entity, component: Component<T>): boolean {
    return component.store.has(entity);
  }

  get<T>(entity: Entity, component: Component<T>): T {
    const v = component.store.get(entity);
    if (v === undefined) {
      throw new Error(`entity ${entity} has no component ${component.name}`);
    }
    return v;
  }

  tryGet<T>(entity: Entity, component: Component<T>): T | undefined {
    return component.store.get(entity);
  }

  /**
   * Iterate entities that have ALL of the given components, in deterministic insertion order of
   * the smallest store. O(min store size). No sorting in the hot path.
   */
  *query(...required: Array<Component<unknown>>): IterableIterator<Entity> {
    let smallest = required[0];
    if (smallest === undefined) return;
    for (const c of required) if (c.store.size < smallest.store.size) smallest = c;

    for (const id of smallest.store.keys()) {
      let ok = true;
      for (const c of required) {
        if (c !== smallest && !c.store.has(id)) {
          ok = false;
          break;
        }
      }
      if (ok) yield id;
    }
  }

  /** All registered components in registration order (for canonical hashing/snapshots). */
  get components(): readonly Component<unknown>[] {
    return this.registered;
  }

  /**
   * Ascending-sorted alive entity ids — the canonical order for snapshots, golden hashes, and any
   * system that must *pick* an entity deterministically. Memoized per alive-set generation (see
   * {@link canonicalCache}); the result is shared + read-only — never mutate it (sort/reverse a copy).
   */
  canonicalEntities(): readonly Entity[] {
    if (this.canonicalCache === null) {
      this.canonicalCache = [...this.alive].sort((a, b) => a - b);
    }
    return this.canonicalCache;
  }

  /**
   * Canonical [componentName, value] pairs for an entity, in registration order. The single
   * traversal used by hashing and (later) snapshot/save — so "what the state is" has one
   * definition, owned by the World, not re-implemented by each consumer.
   */
  componentEntries(entity: Entity): Array<[string, unknown]> {
    const out: Array<[string, unknown]> = [];
    for (const c of this.registered) {
      const v = c.store.get(entity);
      if (v !== undefined) out.push([c.name, v]);
    }
    return out;
  }

  get entityCount(): number {
    return this.alive.size;
  }
}
