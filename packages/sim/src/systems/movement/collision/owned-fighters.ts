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
 * Every firm collider, kept across ticks: an Owner or Settler membership change or a logged trade change
 * re-tests only that entity, so a read costs the changes since the last one, not the population.
 */
interface FighterIndex {
  readonly content: ContentSet;
  readonly feed: ChangeFeed;
  /** Ascending id. */
  readonly fighters: Entity[];
}

const indexes = new WeakMap<World, FighterIndex>();
const idOf = (e: Entity): number => e;

/** The owned fighters in ascending id, walking or not. Valid until the next call; never mutate it. */
export function ownedFighters(world: World, content: ContentSet): readonly Entity[] {
  const held = indexes.get(world);
  if (held === undefined || held.content !== content) return rebuild(world, content).fighters;
  const { fighters } = held;
  const resync = (e: Entity): void => {
    if (!hasBodyCollision(world, content, e)) removeSortedById(fighters, e, idOf);
    else if (!includesSortedId(fighters, e, idOf)) insertSortedById(fighters, e, idOf);
  };
  if (held.feed.drain(resync)) return rebuild(world, content).fighters;
  const trades = settlerTradeLog(world, 'ownedFighters');
  for (const e of trades) resync(e);
  trades.clear();
  return fighters;
}

function rebuild(world: World, content: ContentSet): FighterIndex {
  const held = indexes.get(world);
  const feed = held?.feed ?? world.watchChanges([Owner, Settler], []);
  feed.drain(() => {});
  settlerTradeLog(world, 'ownedFighters').clear();
  const index: FighterIndex = { content, feed, fighters: deriveFighters(world, content) };
  if (held === undefined) world.registerCacheVerifier('ownedFighters', () => verifyIndex(world));
  indexes.set(world, index);
  return index;
}

function deriveFighters(world: World, content: ContentSet): Entity[] {
  return world.canonicalQuery(Owner, Settler).filter((e) => hasBodyCollision(world, content, e));
}

/** Brings the index up to date, then compares it with a fresh scan: a missed trade or membership change
 *  shows up as a fighter the feeds never re-tested. */
function verifyIndex(world: World): string[] {
  const held = indexes.get(world);
  if (held === undefined) return [];
  const listed = ownedFighters(world, held.content);
  const fresh = deriveFighters(world, held.content);
  if (listed.length === fresh.length && listed.every((e, i) => e === fresh[i])) return [];
  return [`ownedFighters holds ${listed.length} fighters but a fresh scan finds ${fresh.length}`];
}
