import {
  Building,
  deadPlayerBits,
  Female,
  isValidPlayer,
  type MatchGoal,
  markGoalVerdict,
  matchGoalTable,
  matchParticipantBits,
  Owner,
  ownerOf,
  Person,
  playerBit,
  playersOfBits,
  Settler,
  Stockpile,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isAdultSettler } from '../family/eligibility.js';
import { stockOf, typeStoresGood } from '../missions/stock.js';
import { isSoldierJob } from '../readviews/index.js';
import { allMutualFriends, hasTwoSeats } from './standing.js';

/**
 * Ticks between two goal checks. Original behavior: the table is checked on every tick count that is a
 * multiple of this, 10 seconds at 12 ticks per second; a reading, not timed against the running game.
 */
export const MATCH_GOAL_CHECK_TICKS = 120;

/** The most of one good the original's per-player tally holds; a larger stock reads as this. */
const GOOD_TALLY_MAX = 0xffff;

type Verdict = 'won' | 'lost';

/**
 * Original behavior: each seat on the map the table has not decided is checked in slot order, a
 * death first and then the rows in table order, and the first that holds decides it for good; a seat
 * that won is never checked again, so a later death does not undo it. A seat that cannot die is
 * checked too. Each seat's verdict is its own: one seat winning ends nothing for the others. The
 * counts walk the buildings and the people once per check, and only when a row reads them.
 */
export function checkMatchGoals(world: World, ctx: SystemContext): void {
  if (ctx.tick % MATCH_GOAL_CHECK_TICKS !== 0) return;
  const table = matchGoalTable(world);
  const pending = table.seats & ~(table.won | table.lost);
  if (pending === 0) return;
  const tallies = new GoalTallies(world, ctx, pending);
  for (const player of playersOfBits(pending)) {
    const verdict = playerVerdict(world, tallies, player);
    if (verdict === undefined) continue;
    markGoalVerdict(world, player, verdict);
    ctx.events.emit({ kind: verdict === 'won' ? 'playerWon' : 'playerDefeated', player });
  }
}

function playerVerdict(world: World, tallies: GoalTallies, player: number): Verdict | undefined {
  const bit = playerBit(player);
  if ((deadPlayerBits(world) & bit) !== 0) return 'lost';
  const table = matchGoalTable(world);
  for (let i = 0; i < table.goals.length; i++) {
    const goal = table.goals[i];
    if (goal === undefined) continue;
    const raised = ((table.raised[i] ?? 0) & bit) !== 0;
    const verdict = goalVerdict(world, tallies, goal, player, raised);
    if (verdict !== undefined) return verdict;
  }
  return undefined;
}

function goalVerdict(
  world: World,
  tallies: GoalTallies,
  goal: MatchGoal,
  player: number,
  raised: boolean,
): Verdict | undefined {
  switch (goal.kind) {
    case 'goods':
      return goal.goods.every(({ good, amount }) => tallies.goods(player, good) >= amount)
        ? 'won'
        : undefined;
    case 'inhabitants': {
      const people = goal.soldiers ? tallies.soldiers(player) : tallies.inhabitants(player);
      // The original compares unsigned, so a negative count is never reached.
      return goal.count >= 0 && people >= goal.count ? 'won' : undefined;
    }
    case 'wonByMission':
      return raised ? 'won' : undefined;
    case 'lostByMission':
      return raised ? 'lost' : undefined;
    case 'lastStanding':
      return lastStanding(world, player) ? 'won' : undefined;
  }
}

/** The skirmish rule as a row, over the participants alone, since a seat that cannot die is no rival
 *  to beat: with two or more, once one is out (dead or lost) and those still standing are all mutual
 *  friends, each standing participant wins. */
function lastStanding(world: World, player: number): boolean {
  const participants = matchParticipantBits(world);
  const out = (deadPlayerBits(world) | matchGoalTable(world).lost) & participants;
  const standing = participants & ~out;
  return (
    hasTwoSeats(participants) &&
    out !== 0 &&
    (standing & playerBit(player)) !== 0 &&
    allMutualFriends(world, playersOfBits(standing))
  );
}

/**
 * The per-player counts the goods and inhabitants rows compare, each taken in one walk on first use.
 * Original behavior: goods are what the player's houses hold in their own stock slots; inhabitants are
 * every human of the player, and soldiers the adult men in a soldier job.
 */
class GoalTallies {
  private goodsByPlayer: Map<number, Map<number, number>> | undefined;
  private people: { readonly all: number[]; readonly soldiers: number[] } | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly players: number,
  ) {}

  goods(player: number, good: number): number {
    this.goodsByPlayer ??= this.countGoods();
    return Math.min(this.goodsByPlayer.get(player)?.get(good) ?? 0, GOOD_TALLY_MAX);
  }

  inhabitants(player: number): number {
    this.people ??= this.countPeople();
    return this.people.all[player] ?? 0;
  }

  soldiers(player: number): number {
    this.people ??= this.countPeople();
    return this.people.soldiers[player] ?? 0;
  }

  private countGoods(): Map<number, Map<number, number>> {
    const { world, ctx } = this;
    const out = new Map<number, Map<number, number>>();
    for (const e of world.query(Building, Stockpile)) {
      const player = ownerOf(world, e);
      if (!this.counts(player)) continue;
      const buildingType = world.get(e, Building).buildingType;
      let goods = out.get(player);
      for (const good of world.get(e, Stockpile).amounts.keys()) {
        if (!typeStoresGood(ctx, buildingType, good)) continue;
        if (goods === undefined) {
          goods = new Map();
          out.set(player, goods);
        }
        goods.set(good, (goods.get(good) ?? 0) + stockOf(world, e, good));
      }
    }
    return out;
  }

  private countPeople(): { readonly all: number[]; readonly soldiers: number[] } {
    const { world, ctx } = this;
    const all: number[] = [];
    const soldiers: number[] = [];
    for (const e of world.query(Person, Owner)) {
      const player = world.get(e, Owner).player;
      if (!this.counts(player)) continue;
      all[player] = (all[player] ?? 0) + 1;
      if (world.has(e, Female) || !isAdultSettler(world, e)) continue;
      if (isSoldierJob(ctx.content, world.tryGet(e, Settler)?.jobType ?? null)) {
        soldiers[player] = (soldiers[player] ?? 0) + 1;
      }
    }
    return { all, soldiers };
  }

  private counts(player: number | undefined): player is number {
    return player !== undefined && isValidPlayer(player) && (this.players & playerBit(player)) !== 0;
  }
}
