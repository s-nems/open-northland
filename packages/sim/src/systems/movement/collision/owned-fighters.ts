import type { ContentSet } from '@open-northland/data';
import { Owner, Settler, settlerTradeLog } from '../../../components/index.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { isFighterJob } from '../../readviews/index.js';

/** Whether `e` is a firm collider: an owned fighter. */
export function hasBodyCollision(world: World, content: ContentSet, e: Entity): boolean {
  if (!world.has(e, Owner)) return false;
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && isFighterJob(content, settler.jobType);
}

/**
 * Every firm collider, kept across ticks, in one list and per owner: an Owner or Settler membership change,
 * an owner write or a logged trade change re-tests only that entity, so a read costs the changes since the
 * last one, not the population.
 */
interface FighterIndex {
  readonly content: ContentSet;
  readonly feed: ChangeFeed;
  /** Ascending id. */
  readonly fighters: Entity[];
  /** Each owner's fighters, ascending id. */
  readonly byOwner: Map<number, Entity[]>;
  /** The owner each listed fighter is filed under. */
  readonly filedUnder: Map<Entity, number>;
}

const indexes = new WeakMap<World, FighterIndex>();
const idOf = (e: Entity): number => e;
const NO_FIGHTERS: readonly Entity[] = [];

/** The owned fighters in ascending id, walking or not. Valid until the next call; never mutate it. */
export function ownedFighters(world: World, content: ContentSet): readonly Entity[] {
  return synced(world, content).fighters;
}

/** `player`'s fighters in ascending id, walking or not, from the same index as {@link ownedFighters}. Valid
 *  until the next call; never mutate it. */
export function ownedFightersOf(world: World, content: ContentSet, player: number): readonly Entity[] {
  return synced(world, content).byOwner.get(player) ?? NO_FIGHTERS;
}

function synced(world: World, content: ContentSet): FighterIndex {
  const held = indexes.get(world);
  if (held === undefined || held.content !== content) return rebuild(world, content);
  const resync = (e: Entity): void => refile(world, held, e);
  if (held.feed.drain(resync)) return rebuild(world, content);
  const trades = settlerTradeLog(world, 'ownedFighters');
  // An empty log is left alone: a long-lived set allocates a fresh table on every clear.
  if (trades.size === 0) return held;
  for (const e of trades) resync(e);
  trades.clear();
  return held;
}

/** Re-test `e` and move it to the lists it now belongs in. */
function refile(world: World, index: FighterIndex, e: Entity): void {
  const owner = hasBodyCollision(world, index.content, e) ? world.get(e, Owner).player : undefined;
  const filed = index.filedUnder.get(e);
  if (owner === undefined) removeSortedById(index.fighters, e, idOf);
  else if (!includesSortedId(index.fighters, e, idOf)) insertSortedById(index.fighters, e, idOf);
  if (filed === owner) return;
  if (filed !== undefined) {
    const list = index.byOwner.get(filed);
    if (list !== undefined) removeSortedById(list, e, idOf);
    index.filedUnder.delete(e);
  }
  if (owner !== undefined) {
    let list = index.byOwner.get(owner);
    if (list === undefined) {
      list = [];
      index.byOwner.set(owner, list);
    }
    insertSortedById(list, e, idOf);
    index.filedUnder.set(e, owner);
  }
}

function rebuild(world: World, content: ContentSet): FighterIndex {
  const held = indexes.get(world);
  const feed = held?.feed ?? world.watchChanges([Owner, Settler], [Owner]);
  feed.drain(() => {});
  settlerTradeLog(world, 'ownedFighters').clear();
  const fighters = deriveFighters(world, content);
  const byOwner = new Map<number, Entity[]>();
  const filedUnder = new Map<Entity, number>();
  for (const e of fighters) {
    const owner = world.get(e, Owner).player;
    let list = byOwner.get(owner);
    if (list === undefined) {
      list = [];
      byOwner.set(owner, list);
    }
    list.push(e);
    filedUnder.set(e, owner);
  }
  const index: FighterIndex = { content, feed, fighters, byOwner, filedUnder };
  if (held === undefined) world.registerCacheVerifier('ownedFighters', () => verifyIndex(world));
  indexes.set(world, index);
  return index;
}

function deriveFighters(world: World, content: ContentSet): Entity[] {
  return world.canonicalQuery(Owner, Settler).filter((e) => hasBodyCollision(world, content, e));
}

/** Brings the index up to date, then compares it with a fresh scan: a missed trade or membership change
 *  shows up as a fighter the feeds never re-tested, or one filed under an owner it no longer has. */
function verifyIndex(world: World): string[] {
  const held = indexes.get(world);
  if (held === undefined) return [];
  const index = synced(world, held.content);
  const fresh = deriveFighters(world, held.content);
  const listed = index.fighters;
  if (listed.length !== fresh.length || !listed.every((e, i) => e === fresh[i])) {
    return [`ownedFighters holds ${listed.length} fighters but a fresh scan finds ${fresh.length}`];
  }
  let filed = 0;
  for (const [owner, list] of index.byOwner) {
    filed += list.length;
    if (!list.every((e) => world.get(e, Owner).player === owner)) {
      return [`ownedFighters files a fighter under player ${owner}, who no longer owns it`];
    }
  }
  return filed === fresh.length ? [] : [`ownedFighters files ${filed} fighters by owner of ${fresh.length}`];
}
