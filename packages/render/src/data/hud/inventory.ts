import {
  type EntitySnapshot,
  type Fixed,
  firstDifference,
  type HalfCellNode,
  heapReach,
  indexesOf,
  nodeOfPosition,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';
import { linkedPosts, signpostOverlayIndex } from '../signposts.js';
import { readAmountPairs, readNumField, readPosition, readStockpileAmounts } from '../snapshot/index.js';

type Components = EntitySnapshot['components'];
export type AmountPairs = readonly (readonly [number, number])[];

/** Physical goods only: orders and reserved cargo are not additional stock. */
export function inventoryAmounts(c: Components): AmountPairs {
  const amounts = [...readStockpileAmounts(c)];
  if (readNumField(c, 'Owner', 'player') === undefined) return amounts;
  const upgrade = c.Upgrading as { savedStock?: unknown } | undefined;
  amounts.push(...readAmountPairs(upgrade?.savedStock));
  const good = readNumField(c, 'Carrying', 'goodType');
  const amount = readNumField(c, 'Carrying', 'amount');
  if (good !== undefined && amount !== undefined) amounts.push([good, amount]);
  const cargo = c.VehicleStock as { lines?: unknown } | undefined;
  if (Array.isArray(cargo?.lines)) {
    for (const line of cargo.lines) {
      if (!Array.isArray(line) || typeof line[0] !== 'number') continue;
      const value = line[1] as { current?: unknown } | undefined;
      if (typeof value?.current === 'number') amounts.push([line[0], value.current]);
    }
  }
  return amounts;
}

export function adjustInventory(totals: Map<number, number>, amounts: AmountPairs, sign: number): void {
  for (const [good, amount] of amounts) {
    const next = (totals.get(good) ?? 0) + sign * amount;
    if (next === 0) totals.delete(good);
    else totals.set(good, next);
  }
}

interface Source {
  readonly owner: number | undefined;
  readonly node: HalfCellNode | null;
  readonly parent: number | undefined;
  readonly amounts: AmountPairs;
}

interface Region {
  readonly player: number;
  readonly revision: number;
  readonly posts: ReadonlySet<number>;
  readonly contains: (node: HalfCellNode) => boolean;
  readonly stock: Map<number, number>;
}

interface Inventory {
  readonly sources: Map<number, Source>;
  readonly dependents: Map<number, Set<number>>;
  readonly owned: Map<number, Map<number, number>>;
  /** Only the most recently read network is maintained; switching networks rebuilds this one scoped aggregate. */
  region: Region | null;
}

function sourceOf(c: Components): Source | null {
  if (!('Stockpile' in c || 'Upgrading' in c || 'Carrying' in c || 'VehicleStock' in c || 'Vehicle' in c))
    return null;
  const p = readPosition(c);
  const node = p === null ? null : nodeOfPosition(p.x as Fixed, p.y as Fixed);
  return {
    owner: readNumField(c, 'Owner', 'player'),
    node,
    parent:
      node === null
        ? (readNumField(c, 'Rider', 'vehicle') ?? readNumField(c, 'Vehicle', 'carrier'))
        : undefined,
    amounts: inventoryAmounts(c),
  };
}

function sourceNode(state: Inventory, id: number): HalfCellNode | null {
  const seen = new Set<number>();
  let current: number | undefined = id;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const source = state.sources.get(current);
    if (source === undefined) return null;
    if (source.node !== null) return source.node;
    current = source.parent;
  }
  return null;
}

function countRegion(state: Inventory, id: number, source: Source, sign: number): void {
  const region = state.region;
  if (region === null || (source.owner !== undefined && source.owner !== region.player)) return;
  const node = sourceNode(state, id);
  if (node !== null && region.contains(node)) adjustInventory(region.stock, source.amounts, sign);
}

function countOwned(state: Inventory, source: Source, sign: number): void {
  if (source.owner === undefined || source.amounts.length === 0) return;
  let totals = state.owned.get(source.owner);
  if (totals === undefined) {
    totals = new Map();
    state.owned.set(source.owner, totals);
  }
  adjustInventory(totals, source.amounts, sign);
  if (totals.size === 0) state.owned.delete(source.owner);
}

function countBranch(state: Inventory, id: number, sign: number, seen = new Set<number>()): void {
  if (seen.has(id)) return;
  seen.add(id);
  const source = state.sources.get(id);
  if (source !== undefined) countRegion(state, id, source, sign);
  for (const child of state.dependents.get(id) ?? []) countBranch(state, child, sign, seen);
}

function replaceSource(state: Inventory, id: number, next: Source | null): void {
  const previous = state.sources.get(id);
  if (previous === undefined && next === null) return;
  countBranch(state, id, -1);
  if (previous !== undefined) {
    countOwned(state, previous, -1);
    if (previous.parent !== undefined) {
      const children = state.dependents.get(previous.parent);
      children?.delete(id);
      if (children?.size === 0) state.dependents.delete(previous.parent);
    }
  }
  if (next === null) state.sources.delete(id);
  else {
    state.sources.set(id, next);
    countOwned(state, next, 1);
    if (next.parent !== undefined) {
      let children = state.dependents.get(next.parent);
      if (children === undefined) {
        children = new Set();
        state.dependents.set(next.parent, children);
      }
      children.add(id);
    }
  }
  countBranch(state, id, 1);
}

const INVENTORY: SnapshotIndexSpec<Inventory> = {
  name: 'HUD inventory',
  reads: {
    values: ['Owner', 'Position', 'Stockpile', 'Upgrading', 'Carrying', 'VehicleStock', 'Rider', 'Vehicle'],
  },
  empty: () => ({ sources: new Map(), dependents: new Map(), owned: new Map(), region: null }),
  add: (state, entity) => replaceSource(state, entity.id, sourceOf(entity.components)),
  remove: (state, entity) => replaceSource(state, entity.id, null),
  replace: (state, previous, next) => {
    const source = sourceOf(next.components);
    if (firstDifference(state.sources.get(previous.id) ?? null, source) === null) return;
    replaceSource(state, next.id, source);
  },
  differs: (held, fresh) => {
    const sourceDifference = firstDifference(held.sources, fresh.sources, 'inventory sources');
    if (sourceDifference !== null) return sourceDifference;
    const ownedDifference = firstDifference(held.owned, fresh.owned, 'owned inventory');
    if (ownedDifference !== null || held.region === null) return ownedDifference;
    fresh.region = { ...held.region, stock: new Map() };
    for (const [id, source] of fresh.sources) countRegion(fresh, id, source, 1);
    return firstDifference(held.region.stock, fresh.region.stock, 'network inventory');
  },
};

export function ownedInventoryOf(snapshot: WorldSnapshot): ReadonlyMap<number, ReadonlyMap<number, number>> {
  return indexesOf(snapshot).get(INVENTORY).owned;
}

export interface NetworkInventory {
  readonly postCount: number;
  readonly stock: ReadonlyMap<number, number>;
}

/** Connected posts define the scope; overlapping ranges include each physical source once. */
export function networkInventoryOf(snapshot: WorldSnapshot, signpost: number): NetworkInventory | null {
  const index = signpostOverlayIndex(snapshot);
  const selected = index.posts.get(signpost);
  if (selected === undefined) return null;
  const state = indexesOf(snapshot).get(INVENTORY);
  let region = state.region;
  if (region === null || region.revision !== index.revision || !region.posts.has(signpost)) {
    const posts = new Set<number>();
    const anchors: HalfCellNode[] = [];
    const pending = [selected];
    for (let i = 0; i < pending.length; i++) {
      const post = pending[i];
      if (post === undefined || posts.has(post.id)) continue;
      posts.add(post.id);
      anchors.push(post);
      pending.push(...linkedPosts(index, post));
    }
    region = {
      player: selected.player,
      revision: index.revision,
      posts,
      contains: heapReach(anchors),
      stock: new Map(),
    };
    state.region = region;
    for (const [id, source] of state.sources) countRegion(state, id, source, 1);
  }
  return { postCount: region.posts.size, stock: region.stock };
}
