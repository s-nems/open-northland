/**
 * A tiny, explicit ECS. Deliberately not a library: we need full control over iteration order
 * (for determinism) and maximum legibility. ~150 lines is the whole thing.
 *
 * Rules (see docs/ECS.md):
 *  - Entities are integer ids, handed out in ascending order.
 *  - Components are plain data registered via defineComponent.
 *  - Queries iterate entities in ascending id order — deterministic, always.
 *  - Components carry no behavior; Systems (plain functions) carry all behavior.
 */

export type Entity = number;

export interface Component<T> {
  readonly name: string;
  /** internal: dense store keyed by entity id. */
  readonly store: Map<Entity, T>;
}

export function defineComponent<T>(name: string): Component<T> {
  return { name, store: new Map<Entity, T>() };
}

export class World {
  private nextId: Entity = 1;
  private readonly alive = new Set<Entity>();
  private readonly components: Array<Component<unknown>> = [];

  /** Create a new entity with no components. */
  create(): Entity {
    const id = this.nextId++;
    this.alive.add(id);
    return id;
  }

  destroy(entity: Entity): void {
    for (const c of this.components) c.store.delete(entity);
    this.alive.delete(entity);
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  /** Attach/overwrite a component value on an entity. */
  add<T>(entity: Entity, component: Component<T>, value: T): T {
    if (!this.components.includes(component as Component<unknown>)) {
      this.components.push(component as Component<unknown>);
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

  /** Get a component value; throws if absent (use `has` first when optional). */
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
   * Iterate entities that have ALL of the given components, in ascending id order.
   * Iterates the smallest component store and filters — O(min store size).
   */
  *query(...required: Array<Component<unknown>>): IterableIterator<Entity> {
    if (required.length === 0) return;
    // Pick the smallest store to drive iteration.
    let smallest = required[0]!;
    for (const c of required) if (c.store.size < smallest.store.size) smallest = c;

    const ids = [...smallest.store.keys()].sort((a, b) => a - b); // deterministic order
    for (const id of ids) {
      let ok = true;
      for (const c of required) {
        if (!c.store.has(id)) {
          ok = false;
          break;
        }
      }
      if (ok) yield id;
    }
  }

  /** Count of currently alive entities (for tests/debug). */
  get entityCount(): number {
    return this.alive.size;
  }
}
