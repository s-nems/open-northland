import type { Component, Entity } from './component.js';

/** Per-stored-value revisions used by detached read caches to reuse unchanged component clones. */
export class ComponentRevisions {
  private readonly byComponent = new Map<Component<unknown>, Map<Entity, number>>();

  register(component: Component<unknown>): void {
    this.byComponent.set(component, new Map<Entity, number>());
  }

  record(component: Component<unknown>, entity: Entity, revision: number): void {
    const revisions = this.byComponent.get(component);
    if (revisions === undefined) throw new Error(`component ${component.name} has no registered store`);
    revisions.set(entity, revision);
  }

  remove(component: Component<unknown>, entity: Entity): void {
    this.byComponent.get(component)?.delete(entity);
  }

  revisionOf(component: Component<unknown>, entity: Entity): number | undefined {
    return this.byComponent.get(component)?.get(entity);
  }
}
