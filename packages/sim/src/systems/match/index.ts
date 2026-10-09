import {
  deadPlayerBits,
  Female,
  goalsMatchVictory,
  isValidPlayer,
  markPlayerDead,
  markPlayersWon,
  matchGoalTable,
  matchParticipantBits,
  Owner,
  Person,
  playerBit,
  playersOfBits,
  scriptedMatchVictory,
  wonPlayerBits,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { isAdultSettler } from '../family/eligibility.js';
import { removeVehiclesOf } from '../vehicles/remove.js';
import { checkMatchGoals } from './goals.js';
import { allMutualFriends, hasTwoSeats } from './standing.js';

export { MATCH_GOAL_CHECK_TICKS } from './goals.js';

/**
 * Death-check cadence in ticks: the first check lands on the cadence tick past the grace period.
 * Approximation modelled on a reading of the original's per-tick player check, unconfirmed against
 * the running original; the counts assume the approximated 12 Hz clock.
 */
export const MATCH_DEATH_GRACE_TICKS = 720;
export const MATCH_DEATH_CHECK_INTERVAL_TICKS = 125;

/** A seat without a living adult man dies (engine-build reading). Skirmish mode needs two seats and
 *  stops after the survivors win by mutual friendship (approximation). Script mode checks even one
 *  seat and leaves victory to script results; death checks continue after a scripted win. Goals mode
 *  checks even one seat and leaves every verdict, a death's defeat included, to the goal table. */
export const matchSystem: System = (world, ctx) => {
  const participants = matchParticipantBits(world);
  // The goal table also decides seats that cannot die, so it runs on its own seats, not the participants.
  if (goalsMatchVictory(world)) {
    if (matchGoalTable(world).seats === 0) return;
    if (deathCheckDue(ctx.tick)) markDeaths(world, ctx, participants, false);
    checkMatchGoals(world, ctx);
    return;
  }
  if (participants === 0) return;
  const scripted = scriptedMatchVictory(world);
  if (!scripted && (!hasTwoSeats(participants) || wonPlayerBits(world) !== 0)) return;
  if (!deathCheckDue(ctx.tick)) return;

  const dead = markDeaths(world, ctx, participants, true);
  if (scripted) return;
  const standing = participants & ~dead;
  if (dead === 0 || standing === 0 || !allMutualFriends(world, playersOfBits(standing))) return;
  markPlayersWon(world, standing);
  for (const player of playersOfBits(standing)) ctx.events.emit({ kind: 'playerWon', player });
};

function deathCheckDue(tick: number): boolean {
  return tick >= MATCH_DEATH_GRACE_TICKS && tick % MATCH_DEATH_CHECK_INTERVAL_TICKS === 0;
}

/** Mark every participant left without a living adult man dead, announcing the defeat when `announce`;
 *  returns the dead set. */
function markDeaths(world: World, ctx: SystemContext, participants: number, announce: boolean): number {
  let dead = deadPlayerBits(world);
  const pending = participants & ~dead;
  if (pending === 0) return dead;
  const manned = playersWithAdultMen(world, pending);
  for (const player of playersOfBits(pending & ~manned)) {
    markPlayerDead(world, player);
    dead |= playerBit(player);
    if (announce) ctx.events.emit({ kind: 'playerDefeated', player });
    // A dead seat's vehicles are destroyed, never transferred (reading of the original's teardown).
    removeVehiclesOf(world, ctx, player);
  }
  return dead;
}

/** The slots of `candidates` owning at least one living adult man, as a bitmask. One pass over the
 *  persons, so the check costs the population once per cadence tick rather than once per player. */
function playersWithAdultMen(world: World, candidates: number): number {
  let manned = 0;
  for (const e of world.query(Person, Owner)) {
    const player = world.get(e, Owner).player;
    if (!isValidPlayer(player)) continue;
    const bit = playerBit(player);
    if ((candidates & bit) === 0 || (manned & bit) !== 0) continue;
    if (world.has(e, Female) || !isAdultSettler(world, e)) continue;
    manned |= bit;
    if (manned === candidates) break;
  }
  return manned;
}
