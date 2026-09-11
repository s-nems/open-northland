import {
  deadPlayerBits,
  diplomacyStance,
  Female,
  isValidPlayer,
  markPlayerDead,
  markPlayersWon,
  matchParticipantBits,
  Owner,
  Person,
  playerBit,
  playersOfBits,
  scriptedMatchVictory,
  wonPlayerBits,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { isAdultSettler } from '../family/eligibility.js';

/**
 * Death-check cadence in ticks: the first check lands on the cadence tick past the grace period.
 * Approximation modelled on a reading of the engine build's per-tick player check, unconfirmed against
 * the running original; the counts assume the approximated 12 Hz clock.
 */
export const MATCH_DEATH_GRACE_TICKS = 720;
export const MATCH_DEATH_CHECK_INTERVAL_TICKS = 125;

/** A seat without a living adult man dies (engine-build reading). Skirmish mode needs two seats and
 *  stops after the survivors win by mutual friendship (approximation). Script mode checks even one
 *  seat and leaves victory to script results; death checks continue after a scripted win. */
export const matchSystem: System = (world, ctx) => {
  const participants = matchParticipantBits(world);
  const scripted = scriptedMatchVictory(world);
  if (participants === 0 || (!scripted && (!hasTwoSeats(participants) || wonPlayerBits(world) !== 0))) return;
  if (ctx.tick < MATCH_DEATH_GRACE_TICKS || ctx.tick % MATCH_DEATH_CHECK_INTERVAL_TICKS !== 0) return;

  let dead = deadPlayerBits(world);
  const pending = participants & ~dead;
  if (pending !== 0) {
    const manned = playersWithAdultMen(world, pending);
    for (const player of playersOfBits(pending & ~manned)) {
      markPlayerDead(world, player);
      dead |= playerBit(player);
      ctx.events.emit({ kind: 'playerDefeated', player });
    }
  }

  if (scripted) return;
  const standing = participants & ~dead;
  if (dead === 0 || standing === 0 || !allMutualFriends(world, playersOfBits(standing))) return;
  markPlayersWon(world, standing);
  for (const player of playersOfBits(standing)) ctx.events.emit({ kind: 'playerWon', player });
};

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

function allMutualFriends(world: World, players: readonly number[]): boolean {
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (b === undefined) continue;
      if (diplomacyStance(world, a, b) !== 'friend' || diplomacyStance(world, b, a) !== 'friend') {
        return false;
      }
    }
  }
  return true;
}

/** At least two bits set: a match with one seat has nobody to beat. */
function hasTwoSeats(bits: number): boolean {
  return (bits & (bits - 1)) !== 0;
}
