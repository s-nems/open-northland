import type { Component, Entity } from './component.js';

/** Per-stored-value revisions used by detached read caches to reuse unchanged component clones. */
export class ComponentRevisions {
  private readonly byComponent: Array<Map<Entity, number> | undefined> = [];

  register(component: Component<unknown>): void {
    this.byComponent[component.id] = new Map<Entity, number>();
  }

  record(component: Component<unknown>, entity: Entity, revision: number): void {
    const revisions = this.byComponent[component.id];
    if (revisions === undefined) throw new Error(`component ${component.name} has no registered store`);
    revisions.set(entity, revision);
  }

  remove(component: Component<unknown>, entity: Entity): void {
    this.byComponent[component.id]?.delete(entity);
  }

  revisionOf(component: Component<unknown>, entity: Entity): number | undefined {
    return this.byComponent[component.id]?.get(entity);
  }
}
