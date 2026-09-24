import { insertSortedById, removeSortedById } from '../core/sorted-id.js';
import type { Component, Entity } from './component.js';

const NO_ENTITIES: readonly Entity[] = Object.freeze([]);
const entityId = (e: Entity): number => e;

/** One component's members in ascending id, kept current by every membership change once tracked. */
interface Members {
  readonly ids: Entity[];
  /** Bumped by a membership change only; a value-replacing re-`add` leaves it alone. */
  epoch: number;
  frozen: readonly Entity[] | null;
}

/** A memoized multi-component result, current while every required component's epoch matches. */
interface Joint {
  readonly required: readonly Component<unknown>[];
  readonly epochs: readonly number[];
  readonly list: readonly Entity[];
}

/** Joint results keyed by the required components in call order, so a lookup allocates nothing. */
interface JointNode {
  readonly next: Map<Component<unknown>, JointNode>;
  joint: Joint | null;
}

/**
 * Ascending-id query results shared by every caller of `World.canonicalQuery`. A component is tracked from
 * its first canonical query on; untracked components pay nothing on add/remove. Results are frozen, so a
 * caller that sorts or splices one in place throws instead of corrupting it for the next reader.
 */
export class CanonicalQueries {
  private readonly members = new Map<Component<unknown>, Members>();
  private readonly joints: JointNode = { next: new Map(), joint: null };

  entered(component: Component<unknown>, entity: Entity): void {
    const m = this.members.get(component);
    if (m === undefined) return;
    // Ids never recycle, so a new entity appends; only a re-entering older one needs the search.
    const last = m.ids[m.ids.length - 1];
    if (last === undefined || last < entity) m.ids.push(entity);
    else insertSortedById(m.ids, entity, entityId);
    m.epoch++;
    m.frozen = null;
  }

  left(component: Component<unknown>, entity: Entity): void {
    const m = this.members.get(component);
    if (m === undefined || !removeSortedById(m.ids, entity, entityId)) return;
    m.epoch++;
    m.frozen = null;
  }

  query(
    stores: ReadonlyMap<Component<unknown>, ReadonlyMap<Entity, unknown>>,
    required: readonly Component<unknown>[],
  ): readonly Entity[] {
    const [first] = required;
    if (first === undefined) return NO_ENTITIES;
    if (required.length === 1) {
      const m = this.track(stores, first);
      if (m === null) return NO_ENTITIES;
      m.frozen ??= Object.freeze(m.ids.slice());
      return m.frozen;
    }
    let node = this.joints;
    for (const c of required) {
      let child = node.next.get(c);
      if (child === undefined) {
        child = { next: new Map(), joint: null };
        node.next.set(c, child);
      }
      node = child;
    }
    const cached = node.joint;
    if (cached !== null && this.current(cached)) return cached.list;
    const joint = this.join(stores, required);
    if (joint === null) return NO_ENTITIES;
    node.joint = joint;
    return joint.list;
  }

  /** Walks the smallest required member list and keeps the ids every other store holds. Null while a
   *  required store does not exist yet. */
  private join(
    stores: ReadonlyMap<Component<unknown>, ReadonlyMap<Entity, unknown>>,
    required: readonly Component<unknown>[],
  ): Joint | null {
    const epochs: number[] = [];
    const others: Array<ReadonlyMap<Entity, unknown>> = [];
    let smallest: Members | null = null;
    let smallestStore: ReadonlyMap<Entity, unknown> | null = null;
    for (const c of required) {
      const store = stores.get(c);
      const m = this.track(stores, c);
      if (store === undefined || m === null) return null;
      epochs.push(m.epoch);
      others.push(store);
      if (smallest === null || m.ids.length < smallest.ids.length) {
        smallest = m;
        smallestStore = store;
      }
    }
    if (smallest === null) return null;
    const list = smallest.ids.filter((e) => others.every((s) => s === smallestStore || s.has(e)));
    return { required, epochs, list: Object.freeze(list) };
  }

  private current(joint: Joint): boolean {
    return joint.required.every((c, i) => this.members.get(c)?.epoch === joint.epochs[i]);
  }

  private track(
    stores: ReadonlyMap<Component<unknown>, ReadonlyMap<Entity, unknown>>,
    component: Component<unknown>,
  ): Members | null {
    let m = this.members.get(component);
    if (m === undefined) {
      const store = stores.get(component);
      if (store === undefined) return null;
      m = { ids: [...store.keys()].sort((a, b) => a - b), epoch: 0, frozen: null };
      this.members.set(component, m);
    }
    return m;
  }

  /** Re-derive every tracked list and every current joint from the stores; a message per mismatch. */
  verify(stores: ReadonlyMap<Component<unknown>, ReadonlyMap<Entity, unknown>>): string[] {
    const out: string[] = [];
    for (const [component, m] of this.members) {
      const fresh = [...(stores.get(component)?.keys() ?? [])].sort((a, b) => a - b);
      if (!sameIds(m.ids, fresh))
        out.push(`canonicalQuery(${component.name}) members diverge from the store`);
      if (m.frozen !== null && !sameIds(m.frozen, m.ids)) {
        out.push(`canonicalQuery(${component.name}) frozen list is stale`);
      }
    }
    const pending = [this.joints];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      pending.push(...node.next.values());
      const joint = node.joint;
      const head = joint?.required[0];
      if (joint === null || head === undefined || !this.current(joint)) continue;
      const fresh = [...(stores.get(head)?.keys() ?? [])]
        .filter((e) => joint.required.every((c) => stores.get(c)?.has(e) === true))
        .sort((a, b) => a - b);
      if (!sameIds(joint.list, fresh)) {
        out.push(`canonicalQuery(${joint.required.map((c) => c.name).join(', ')}) diverges from the stores`);
      }
    }
    return out;
  }
}

function sameIds(a: readonly Entity[], b: readonly Entity[]): boolean {
  return a.length === b.length && a.every((e, i) => e === b[i]);
}
