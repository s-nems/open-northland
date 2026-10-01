import type { ContentSet } from '@open-northland/data';
import { Owner, Person, Position, Settler, settlerTradeLog } from '../../components/index.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { isScoutJob } from '../readviews/index.js';

/** Whether `e` claims livestock it passes: an owned, positioned person in a scout trade. */
function isClaimingScout(world: World, content: ContentSet, e: Entity): boolean {
  if (!world.has(e, Person) || !world.has(e, Owner) || !world.has(e, Position)) return false;
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && isScoutJob(content, settler.jobType);
}

/** Every claiming scout, kept across ticks: a membership change of a store the test reads or a logged
 *  trade change re-tests only that entity, so a read costs the changes since the last one. */
interface ScoutIndex {
  readonly content: ContentSet;
  readonly feed: ChangeFeed;
  /** Ascending id. */
  readonly scouts: Entity[];
}

const indexes = new WeakMap<World, ScoutIndex>();
const idOf = (e: Entity): number => e;

/** The claiming scouts in ascending id. Valid until the next call; never mutate it. */
export function claimingScouts(world: World, content: ContentSet): readonly Entity[] {
  const held = indexes.get(world);
  if (held === undefined || held.content !== content) return rebuild(world, content).scouts;
  const { scouts } = held;
  const resync = (e: Entity): void => {
    if (!isClaimingScout(world, content, e)) removeSortedById(scouts, e, idOf);
    else if (!includesSortedId(scouts, e, idOf)) insertSortedById(scouts, e, idOf);
  };
  if (held.feed.drain(resync)) return rebuild(world, content).scouts;
  const trades = settlerTradeLog(world, 'livestockScouts');
  for (const e of trades) resync(e);
  trades.clear();
  return scouts;
}

function rebuild(world: World, content: ContentSet): ScoutIndex {
  const held = indexes.get(world);
  const feed = held?.feed ?? world.watchChanges([Person, Owner, Position, Settler], []);
  feed.drain(() => {});
  settlerTradeLog(world, 'livestockScouts').clear();
  const index: ScoutIndex = { content, feed, scouts: deriveScouts(world, content) };
  if (held === undefined) world.registerCacheVerifier('livestockScouts', () => verifyIndex(world));
  indexes.set(world, index);
  return index;
}

function deriveScouts(world: World, content: ContentSet): Entity[] {
  return world.canonicalQuery(Person, Owner, Position).filter((e) => isClaimingScout(world, content, e));
}

/** Brings the index up to date, then compares it with a fresh scan: a missed trade or membership change
 *  shows up as a scout the feeds never re-tested. */
function verifyIndex(world: World): string[] {
  const held = indexes.get(world);
  if (held === undefined) return [];
  const listed = claimingScouts(world, held.content);
  const fresh = deriveScouts(world, held.content);
  if (listed.length === fresh.length && listed.every((e, i) => e === fresh[i])) return [];
  return [`livestockScouts holds ${listed.length} scouts but a fresh scan finds ${fresh.length}`];
}
