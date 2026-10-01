import type { ContentSet } from '@open-northland/data';
import {
  Owner,
  ownerOf,
  Person,
  PlayerPlacementRules,
  playerPlacementTribes,
  Settler,
  settlerTradeLog,
  tribeUnlockedFor,
  unlockSeatTribe,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { ChangeFeed, Component, Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { isHeroJob } from '../readviews/jobs.js';

/** What the sweep has not looked at yet: membership changes of the stores that decide whether a
 *  settler unlocks a tribe, trade writes (a hero retrained into a trade), and the placement rules. */
interface UnlockMemo {
  readonly feed: ChangeFeed;
  readonly trades: Set<Entity>;
  rules: number;
}

const MEMBERSHIP_INPUTS: readonly Component<unknown>[] = [Person, Settler, Owner];

const memos = new WeakMap<World, UnlockMemo>();

function rulesGeneration(world: World): number {
  return (
    world.componentGeneration(PlayerPlacementRules) + world.componentValueGeneration(PlayerPlacementRules)
  );
}

/** Whether `tribe` has houses to unlock: a monster folk such as the weresnakes allows none, so a seat
 *  fielding one gains no build nation from it. A tribe without an allow table allows every house. */
function buildsHouses(content: ContentSet, tribe: number): boolean {
  const houses = contentIndex(content).tribes.get(tribe)?.permissions?.house;
  return houses === undefined || houses.length > 0;
}

/** Whether `e` is an ordinary settler of a seat with declared rules whose tribe that seat still lacks.
 *  A hero never unlocks his nation: an owner ruling, since maps often hand a player a foreign hero;
 *  the original's own rule for heroes is unconfirmed. */
function unlocksTribe(world: World, content: ContentSet, e: Entity): { owner: number; tribe: number } | null {
  if (!world.has(e, Person)) return null;
  const settler = world.tryGet(e, Settler);
  const owner = ownerOf(world, e);
  if (settler === undefined || owner === undefined || isHeroJob(content, settler.jobType)) return null;
  if (playerPlacementTribes(world, owner) === null || tribeUnlockedFor(world, owner, settler.tribe))
    return null;
  if (!buildsHouses(content, settler.tribe)) return null;
  return { owner, tribe: settler.tribe };
}

function memoOf(world: World, content: ContentSet): UnlockMemo {
  const held = memos.get(world);
  if (held !== undefined) return held;
  const memo: UnlockMemo = {
    feed: world.watchChanges(MEMBERSHIP_INPUTS, []),
    trades: settlerTradeLog(world, 'tribeUnlocks'),
    rules: Number.NaN,
  };
  memos.set(world, memo);
  world.registerCacheVerifier('tribeUnlocks', () => verifyUnlocks(world, content, memo));
  return memo;
}

/** Every settler the next pass would not visit must already have its tribe unlocked. */
function verifyUnlocks(world: World, content: ContentSet, memo: UnlockMemo): string[] {
  if (memo.rules !== rulesGeneration(world)) return [];
  const pending = new Set(memo.trades);
  if (memo.feed.peek((e) => pending.add(e))) return [];
  for (const e of world.query(Person, Settler)) {
    if (!pending.has(e) && unlocksTribe(world, content, e) !== null) {
      return [`tribeUnlocks: settler ${e} holds a tribe its seat has not unlocked`];
    }
  }
  return [];
}

/**
 * Unlock a seat's tribe once it owns an ordinary settler of it. A pass visits only the settlers whose
 * person, settler or owner membership or trade changed since the last one, and every settler again
 * when the placement rules change. Unlocks are a sorted set, so visiting order cannot matter.
 */
export const tribeUnlockSystem: System = (world, ctx) => {
  const memo = memoOf(world, ctx.content);
  const visit = (e: Entity): void => {
    const unlock = unlocksTribe(world, ctx.content, e);
    if (unlock !== null) unlockSeatTribe(world, unlock.owner, unlock.tribe);
  };
  const rules = rulesGeneration(world);
  let rescan = memo.rules !== rules;
  memo.rules = rules;
  if (memo.feed.drain(visit)) rescan = true;
  for (const e of memo.trades) visit(e);
  memo.trades.clear();
  if (rescan) for (const e of world.query(Person, Settler)) visit(e);
};
