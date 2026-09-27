import { insertSortedById, removeSortedById } from '../core/sorted-id.js';
import type { Component, Entity } from './component.js';

type Stores = ReadonlyMap<Component<unknown>, ReadonlyMap<Entity, unknown>>;

const NO_ENTITIES: readonly Entity[] = [];
const entityId = (e: Entity): number => e;

/** One component's members in ascending id, kept current by every membership change once tracked. */
interface Members {
  readonly ids: Entity[];
  /** The copy handed to readers; dropped by a membership change, remade by the next query. */
  shared: Entity[] | null;
  /** The joints requiring this component, updated with it. */
  readonly joints: Joint[];
}

/** The entities carrying every required component in ascending id, updated per membership change. */
interface Joint {
  readonly required: readonly Component<unknown>[];
  readonly stores: readonly ReadonlyMap<Entity, unknown>[];
  readonly ids: Entity[];
  shared: Entity[] | null;
}

/** Joints keyed by the required components in call order, so a lookup allocates nothing. */
interface JointNode {
  readonly next: Map<Component<unknown>, JointNode>;
  joint: Joint | null;
}

/**
 * Ascending-id query results shared by every caller of `World.canonicalQuery`. A component is tracked from
 * its first canonical query on and a joint from its first query; untracked components pay nothing on
 * add/remove. A reader gets a copy made on the first query after its list changed, so a held list stays
 * a snapshot. Copies are not frozen: `readonly` types and {@link verify} catch a reader that edits one.
 */
export class CanonicalQueries {
  private readonly members = new Map<Component<unknown>, Members>();
  private readonly trie: JointNode = { next: new Map(), joint: null };
  private readonly joints: Joint[] = [];

  constructor(private readonly stores: Stores) {}

  entered(component: Component<unknown>, entity: Entity): void {
    const m = this.members.get(component);
    if (m === undefined) return;
    insertSortedById(m.ids, entity, entityId);
    m.shared = null;
    for (const joint of m.joints) {
      if (!carriesAll(joint.stores, entity)) continue;
      insertSortedById(joint.ids, entity, entityId);
      joint.shared = null;
    }
  }

  left(component: Component<unknown>, entity: Entity): void {
    const m = this.members.get(component);
    if (m === undefined || !removeSortedById(m.ids, entity, entityId)) return;
    m.shared = null;
    for (const joint of m.joints) {
      if (removeSortedById(joint.ids, entity, entityId)) joint.shared = null;
    }
  }

  query(required: readonly Component<unknown>[]): readonly Entity[] {
    const [first] = required;
    if (first === undefined) return NO_ENTITIES;
    if (required.length === 1) {
      const m = this.track(first);
      if (m === null) return NO_ENTITIES;
      m.shared ??= m.ids.slice();
      return m.shared;
    }
    let node = this.trie;
    for (const c of required) {
      let child = node.next.get(c);
      if (child === undefined) {
        child = { next: new Map(), joint: null };
        node.next.set(c, child);
      }
      node = child;
    }
    node.joint ??= this.join(required);
    const joint = node.joint;
    if (joint === null) return NO_ENTITIES;
    joint.shared ??= joint.ids.slice();
    return joint.shared;
  }

  /** Walks the smallest required member list once and registers the joint with every required component.
   *  Null while a required store does not exist yet. */
  private join(required: readonly Component<unknown>[]): Joint | null {
    const stores: Array<ReadonlyMap<Entity, unknown>> = [];
    const tracked: Members[] = [];
    let smallest: Members | null = null;
    for (const c of required) {
      const store = this.stores.get(c);
      const m = this.track(c);
      if (store === undefined || m === null) return null;
      stores.push(store);
      tracked.push(m);
      if (smallest === null || m.ids.length < smallest.ids.length) smallest = m;
    }
    if (smallest === null) return null;
    const ids = smallest.ids.filter((e) => stores.every((s) => s.has(e)));
    const joint: Joint = { required, stores, ids, shared: null };
    for (const m of tracked) if (!m.joints.includes(joint)) m.joints.push(joint);
    this.joints.push(joint);
    return joint;
  }

  private track(component: Component<unknown>): Members | null {
    let m = this.members.get(component);
    if (m === undefined) {
      const store = this.stores.get(component);
      if (store === undefined) return null;
      m = { ids: [...store.keys()].sort((a, b) => a - b), shared: null, joints: [] };
      this.members.set(component, m);
    }
    return m;
  }

  /** Re-derive every tracked list and joint from the stores; a message per mismatch, including a shared
   *  copy a reader edited in place. */
  verify(): string[] {
    const out: string[] = [];
    for (const [component, m] of this.members) {
      const fresh = [...(this.stores.get(component)?.keys() ?? [])].sort((a, b) => a - b);
      out.push(...divergence(component.name, m, fresh));
    }
    for (const joint of this.joints) {
      const [head] = joint.stores;
      const fresh = [...(head?.keys() ?? [])]
        .filter((e) => joint.stores.every((s) => s.has(e)))
        .sort((a, b) => a - b);
      out.push(...divergence(joint.required.map((c) => c.name).join(', '), joint, fresh));
    }
    return out;
  }
}

function carriesAll(stores: readonly ReadonlyMap<Entity, unknown>[], entity: Entity): boolean {
  for (let i = 0; i < stores.length; i++) if (stores[i]?.has(entity) !== true) return false;
  return true;
}

function divergence(
  name: string,
  list: { readonly ids: readonly Entity[]; readonly shared: readonly Entity[] | null },
  fresh: readonly Entity[],
): string[] {
  if (!sameIds(list.ids, fresh)) return [`canonicalQuery(${name}) diverges from the stores`];
  if (list.shared !== null && !sameIds(list.shared, fresh)) {
    return [`canonicalQuery(${name}) shared list was edited by a reader`];
  }
  return [];
}

function sameIds(a: readonly Entity[], b: readonly Entity[]): boolean {
  return a.length === b.length && a.every((e, i) => e === b[i]);
}
