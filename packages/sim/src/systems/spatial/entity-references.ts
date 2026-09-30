import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed, Component, DeepReadonly, Entity, World } from '../../ecs/world.js';

const byId = (e: Entity): number => e;
const EMPTY: readonly Entity[] = [];

/** A reverse component reference, maintained from changed entities rather than rescanning per target. */
export class EntityReferences<T> {
  private readonly feed: ChangeFeed;
  private readonly targetByEntity = new Map<Entity, Entity>();
  private readonly entitiesByTarget = new Map<Entity, Entity[]>();
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(
    private readonly world: World,
    private readonly component: Component<T>,
    private readonly targetOf: (value: DeepReadonly<T>) => Entity,
  ) {
    this.feed = world.watchChanges([component], [component]);
    this.rebuild();
  }

  /** Shared ascending list; copy before changing the indexed component during iteration. */
  at(target: Entity): readonly Entity[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    return this.entitiesByTarget.get(target) ?? EMPTY;
  }

  private refresh(e: Entity): void {
    const value = this.world.tryGet(e, this.component);
    const next = value === undefined ? undefined : this.targetOf(value);
    const old = this.targetByEntity.get(e);
    if (old === next) return;
    if (old !== undefined) {
      const list = this.entitiesByTarget.get(old);
      if (list !== undefined) {
        removeSortedById(list, e, byId);
        if (list.length === 0) this.entitiesByTarget.delete(old);
      }
      this.targetByEntity.delete(e);
    }
    if (next === undefined) return;
    this.targetByEntity.set(e, next);
    const list = this.entitiesByTarget.get(next);
    if (list === undefined) this.entitiesByTarget.set(next, [e]);
    else insertSortedById(list, e, byId);
  }

  private rebuild(): void {
    this.targetByEntity.clear();
    this.entitiesByTarget.clear();
    for (const e of this.world.canonicalQuery(this.component)) this.refresh(e);
  }

  verify(): string[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    const fresh = new Map<Entity, Entity[]>();
    for (const e of this.world.canonicalQuery(this.component)) {
      const target = this.targetOf(this.world.get(e, this.component));
      const list = fresh.get(target);
      if (list === undefined) fresh.set(target, [e]);
      else list.push(e);
    }
    if (fresh.size !== this.entitiesByTarget.size) return ['reference index target membership diverges'];
    for (const [target, expected] of fresh) {
      const actual = this.entitiesByTarget.get(target) ?? EMPTY;
      if (actual.length !== expected.length || expected.some((e, i) => actual[i] !== e)) {
        return [`reference index diverges at target ${target}`];
      }
    }
    return [];
  }
}
