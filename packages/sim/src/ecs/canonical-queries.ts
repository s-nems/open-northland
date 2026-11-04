import type { Component, Entity } from './component.js';
import type { ComponentStore } from './component-store.js';

type Stores = ReadonlyMap<Component<unknown>, ComponentStore<unknown>>;

const NO_ENTITIES: readonly Entity[] = [];
const ascending = (a: Entity, b: Entity): number => a - b;
/** Pending entities a list holds before it settles without a query, beyond its own length: a list
 *  nobody queries any more stays bounded while the merge cost is still spread over many changes. */
const PENDING_SETTLE_MIN = 64;
/** Pending lists up to this long are insertion-sorted in place; a longer one sorts in a typed copy, since
 *  the array sort copies its input. */
const INSERTION_SORT_MAX = 32;
/** The copy a long pending list sorts in, grown to the longest; float64 holds any entity id exactly. */
let sortScratch = new Float64Array(0);
/** The list one settle merges into before it is copied out at its exact length. Settles never nest. */
const mergeScratch: Entity[] = [];

/**
 * Ascending ids handed to readers as they are, never edited in place: changes collect in
 * {@link pending} and the next query merges them into a fresh array, so a held list stays a snapshot.
 */
interface SortedIds {
  ids: readonly Entity[];
  /** The stores a member carries: one for a component's members, every required one for a joint. */
  readonly stores: readonly ComponentStore<unknown>[];
  /** Entities whose membership may have changed since {@link ids} was built, unsorted, repeats allowed:
   *  the first {@link pendingCount}, the array keeping its storage across settles. */
  readonly pending: Entity[];
  pendingCount: number;
}

/** One component's members, kept current by every membership change once tracked. */
interface Members extends SortedIds {
  /** The joints requiring this component, updated with it. */
  readonly joints: Joint[];
}

/** The entities carrying every required component, updated per membership change. */
interface Joint extends SortedIds {
  readonly required: readonly Component<unknown>[];
}

/** Joints keyed by the required components in call order, so a lookup allocates nothing. */
interface JointNode {
  readonly next: Map<Component<unknown>, JointNode>;
  joint: Joint | null;
}

/**
 * Ascending-id query results shared by every caller of `World.canonicalQuery`. A component is tracked from
 * its first canonical query on and a joint from its first query; untracked components pay nothing on
 * add/remove. A membership change only notes the entity; the next query re-checks the noted entities
 * against the stores and merges them in one pass, which also makes the new list readers get. Lists are
 * not frozen: a reader that edits one corrupts it for every later caller until a membership change
 * replaces it. `readonly` types and {@link verify} catch such an edit; verify settles first, so a missed
 * `changed` for an entity that is already pending is repaired silently rather than reported.
 */
export class CanonicalQueries {
  private readonly members = new Map<Component<unknown>, Members>();
  private readonly trie: JointNode = { next: new Map(), joint: null };
  private readonly joints: Joint[] = [];

  constructor(private readonly stores: Stores) {}

  /** `entity` entered or left `component`'s store. */
  changed(component: Component<unknown>, entity: Entity): void {
    const m = this.members.get(component);
    if (m === undefined) return;
    note(m, entity);
    for (let i = 0; i < m.joints.length; i++) note(m.joints[i] as Joint, entity);
  }

  query(required: readonly Component<unknown>[]): readonly Entity[] {
    const first = required[0];
    if (first === undefined) return NO_ENTITIES;
    if (required.length === 1) {
      const m = this.track(first);
      if (m === null) return NO_ENTITIES;
      settle(m);
      return m.ids;
    }
    let node = this.trie;
    for (let i = 0; i < required.length; i++) {
      const c = required[i] as Component<unknown>;
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
    settle(joint);
    return joint.ids;
  }

  /** Walks the smallest required member list once and registers the joint with every required component.
   *  Null while a required store does not exist yet. */
  private join(required: readonly Component<unknown>[]): Joint | null {
    const stores: Array<ComponentStore<unknown>> = [];
    const tracked: Members[] = [];
    let smallest: Members | null = null;
    for (const c of required) {
      const m = this.track(c);
      if (m === null) return null;
      settle(m);
      stores.push(...m.stores);
      tracked.push(m);
      if (smallest === null || m.ids.length < smallest.ids.length) smallest = m;
    }
    if (smallest === null) return null;
    const ids = smallest.ids.filter((e) => carriesAll(stores, e));
    const joint: Joint = { required, stores, ids, pending: [], pendingCount: 0 };
    for (const m of tracked) if (!m.joints.includes(joint)) m.joints.push(joint);
    this.joints.push(joint);
    return joint;
  }

  private track(component: Component<unknown>): Members | null {
    let m = this.members.get(component);
    if (m === undefined) {
      const store = this.stores.get(component);
      if (store === undefined) return null;
      m = { stores: [store], ids: store.keys().sort(ascending), pending: [], pendingCount: 0, joints: [] };
      this.members.set(component, m);
    }
    return m;
  }

  /** Re-derive every tracked list and joint from the stores; a message per mismatch. Settles pending
   *  changes first, so only a change no {@link changed} call reported, or a reader's edit, shows. */
  verify(): string[] {
    const out: string[] = [];
    for (const [component, m] of this.members) {
      settle(m);
      const fresh = (this.stores.get(component)?.keys() ?? []).sort(ascending);
      out.push(...divergence(component.name, m.ids, fresh));
    }
    for (const joint of this.joints) {
      settle(joint);
      const [head] = joint.stores;
      const fresh = (head?.keys() ?? []).filter((e) => carriesAll(joint.stores, e)).sort(ascending);
      out.push(...divergence(joint.required.map((c) => c.name).join(', '), joint.ids, fresh));
    }
    return out;
  }
}

function note(list: SortedIds, entity: Entity): void {
  list.pending[list.pendingCount++] = entity;
  if (list.pendingCount > Math.max(list.ids.length, PENDING_SETTLE_MIN)) settle(list);
}

/** Merge the pending entities into a fresh ascending list, each kept only while it carries every store;
 *  the old list stays as it is for readers holding it, and stays current when nothing moved. */
function settle(list: SortedIds): void {
  const { pending, ids } = list;
  const count = list.pendingCount;
  if (count === 0) return;
  sortPending(pending, count);
  list.pendingCount = 0;
  // Merged into the scratch from the first pending entity whose membership moved, unchanged prefix first.
  let merging = false;
  let n = 0;
  let at = 0;
  let previous: Entity | undefined;
  for (let i = 0; i < count; i++) {
    const e = pending[i] as Entity;
    if (e === previous) continue;
    previous = e;
    while (at < ids.length && (ids[at] as Entity) < e) {
      if (merging) mergeScratch[n++] = ids[at] as Entity;
      at++;
    }
    const held = at < ids.length && ids[at] === e;
    if (held) at++;
    const member = carriesAll(list.stores, e);
    if (!merging && member !== held) {
      merging = true;
      const prefix = held ? at - 1 : at;
      for (let k = 0; k < prefix; k++) mergeScratch[n++] = ids[k] as Entity;
    }
    if (member && merging) mergeScratch[n++] = e;
  }
  if (!merging) return;
  while (at < ids.length) mergeScratch[n++] = ids[at++] as Entity;
  list.ids = mergeScratch.slice(0, n);
}

/** Sort the first `count` pending entities ascending, in place. */
function sortPending(pending: Entity[], count: number): void {
  if (count > INSERTION_SORT_MAX) {
    if (sortScratch.length < count) sortScratch = new Float64Array(Math.max(count, 2 * sortScratch.length));
    for (let i = 0; i < count; i++) sortScratch[i] = pending[i] as Entity;
    const sorted = sortScratch.subarray(0, count).sort();
    for (let i = 0; i < count; i++) pending[i] = sorted[i] as Entity;
    return;
  }
  for (let i = 1; i < count; i++) {
    const e = pending[i] as Entity;
    let k = i - 1;
    while (k >= 0 && (pending[k] as Entity) > e) {
      pending[k + 1] = pending[k] as Entity;
      k--;
    }
    pending[k + 1] = e;
  }
}

function carriesAll(stores: readonly ComponentStore<unknown>[], entity: Entity): boolean {
  for (let i = 0; i < stores.length; i++) if (stores[i]?.has(entity) !== true) return false;
  return true;
}

function divergence(name: string, ids: readonly Entity[], fresh: readonly Entity[]): string[] {
  const same = ids.length === fresh.length && ids.every((e, i) => e === fresh[i]);
  return same
    ? []
    : [`canonicalQuery(${name}) diverges from the stores - a missed change or a reader's edit`];
}
