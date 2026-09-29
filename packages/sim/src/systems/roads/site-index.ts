import { Owner, ownerOf, Position, RoadSite, Stockpile } from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** The tally key of a site no player owns. */
const NEUTRAL = -1;

/** One owner's road sites no builder has claimed, split by whether stock already lies on them. */
export interface OpenRoadSites {
  unstocked: number;
  stocked: number;
}

interface SiteEntry {
  readonly node: NodeId;
  readonly owner: number;
  readonly open: boolean;
  readonly stocked: boolean;
}

interface RoadSiteIndex {
  readonly terrain: TerrainGraph;
  readonly feed: ChangeFeed;
  readonly byNode: Map<NodeId, Entity>;
  readonly entries: Map<Entity, SiteEntry>;
  readonly openByOwner: Map<number, OpenRoadSites>;
}

const indexes = new WeakMap<World, RoadSiteIndex>();

/**
 * The road sites by node, and per owner the unclaimed ones, kept per world from a change feed so a
 * placement probe, a finish or a builder's plan costs the sites that changed rather than a walk over
 * every site. A site takes its Position first and never moves; its claim and stock change in place.
 * One node holds at most one site. Derived read state, never hashed.
 */
function indexOf(world: World, terrain: TerrainGraph): RoadSiteIndex {
  let index = indexes.get(world);
  if (index === undefined || index.terrain !== terrain) {
    index = {
      terrain,
      feed: world.watchChanges([RoadSite, Owner], [RoadSite, Stockpile]),
      byNode: new Map(),
      entries: new Map(),
      openByOwner: new Map(),
    };
    indexes.set(world, index);
    rebuildIndex(world, index);
    world.registerCacheVerifier('roadSiteIndex', () => verifyIndex(world));
    return index;
  }
  const current = index;
  const lost = current.feed.drain((e) => refreshEntry(world, current, e));
  if (lost) rebuildIndex(world, current);
  return current;
}

export function roadSitesByNode(world: World, terrain: TerrainGraph): ReadonlyMap<NodeId, Entity> {
  return indexOf(world, terrain).byNode;
}

/** `owner`'s unclaimed road sites, or every owner's for an unowned asker. Read-only. */
export function openRoadSites(world: World, terrain: TerrainGraph, owner: number | undefined): OpenRoadSites {
  const { openByOwner } = indexOf(world, terrain);
  if (owner !== undefined) return openByOwner.get(owner) ?? { unstocked: 0, stocked: 0 };
  const total = { unstocked: 0, stocked: 0 };
  for (const tally of openByOwner.values()) {
    total.unstocked += tally.unstocked;
    total.stocked += tally.stocked;
  }
  return total;
}

function tally(index: RoadSiteIndex, entry: SiteEntry, delta: number): void {
  if (!entry.open) return;
  let held = index.openByOwner.get(entry.owner);
  if (held === undefined) {
    held = { unstocked: 0, stocked: 0 };
    index.openByOwner.set(entry.owner, held);
  }
  if (entry.stocked) held.stocked += delta;
  else held.unstocked += delta;
}

function refreshEntry(world: World, index: RoadSiteIndex, e: Entity): void {
  const held = index.entries.get(e);
  if (held !== undefined) {
    index.entries.delete(e);
    if (index.byNode.get(held.node) === e) index.byNode.delete(held.node);
    tally(index, held, -1);
  }
  const site = world.tryGet(e, RoadSite);
  const p = site === undefined ? undefined : world.tryGet(e, Position);
  if (site === undefined || p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const entry: SiteEntry = {
    node: index.terrain.nodeAtClamped(hx, hy),
    owner: ownerOf(world, e) ?? NEUTRAL,
    open: site.reservation === null,
    stocked: holdsStock(world, e),
  };
  index.entries.set(e, entry);
  index.byNode.set(entry.node, e);
  tally(index, entry, 1);
}

function holdsStock(world: World, e: Entity): boolean {
  const amounts = world.tryGet(e, Stockpile)?.amounts;
  if (amounts === undefined) return false;
  for (const amount of amounts.values()) if (amount > 0) return true;
  return false;
}

function rebuildIndex(world: World, index: RoadSiteIndex): void {
  index.byNode.clear();
  index.entries.clear();
  index.openByOwner.clear();
  for (const e of world.canonicalQuery(RoadSite, Position)) refreshEntry(world, index, e);
}

function verifyIndex(world: World): string[] {
  const index = indexes.get(world);
  if (index === undefined || index.feed.pending) return [];
  const fresh: RoadSiteIndex = { ...index, byNode: new Map(), entries: new Map(), openByOwner: new Map() };
  rebuildIndex(world, fresh);
  const out: string[] = [];
  if (fresh.entries.size !== index.entries.size) out.push('road site index diverges from the live sites');
  for (const [e, entry] of fresh.entries) {
    const held = index.entries.get(e);
    if (
      held === undefined ||
      held.node !== entry.node ||
      held.owner !== entry.owner ||
      held.open !== entry.open ||
      held.stocked !== entry.stocked
    ) {
      out.push(`road site ${e} is indexed stale`);
    }
  }
  for (const owner of new Set([...fresh.openByOwner.keys(), ...index.openByOwner.keys()])) {
    const want = fresh.openByOwner.get(owner);
    const held = index.openByOwner.get(owner);
    if ((want?.unstocked ?? 0) !== (held?.unstocked ?? 0) || (want?.stocked ?? 0) !== (held?.stocked ?? 0)) {
      out.push(`open road sites of owner ${owner} are tallied stale`);
    }
  }
  return out;
}
