import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer, MAX_PLAYERS } from './ownership.js';

/** Player-slot bitmasks: slots are `< MAX_PLAYERS`, so each set fits one integer and hashes canonically. */
const matchRules = defineWorldSingleton<{
  /** The seats that play the match; a world declaring none runs no match. */
  participants: number;
  /** Participants that died: their commands are refused from then on. */
  dead: number;
  /** Participants that won; set once, when the standing seats are all mutual friends. */
  won: number;
}>('MatchRules', 'players', () => ({ participants: 0, dead: 0, won: 0 }));

/**
 * The skirmish match state the `setMatchParticipants` command opens and the MatchSystem drives. Kept
 * apart from the other rule singletons so declaring a match never materializes them.
 */
export const MatchRules = matchRules.component;

export type MatchOutcome = 'undecided' | 'defeat' | 'victory';

export function playerBit(player: number): number {
  return 1 << player;
}

/** The slots set in `bits`, ascending. */
export function playersOfBits(bits: number): number[] {
  const players: number[] = [];
  for (let p = 0; p < MAX_PLAYERS; p++) if ((bits & playerBit(p)) !== 0) players.push(p);
  return players;
}

export function matchParticipantBits(world: World): number {
  return matchRules.read(world).participants;
}

export function deadPlayerBits(world: World): number {
  return matchRules.read(world).dead;
}

export function wonPlayerBits(world: World): number {
  return matchRules.read(world).won;
}

export function isMatchParticipant(world: World, player: number): boolean {
  return isValidPlayer(player) && (matchParticipantBits(world) & playerBit(player)) !== 0;
}

/** Whether `player` died in the match. A non-participant or an invalid slot never dies. */
export function isPlayerDead(world: World, player: number): boolean {
  return isValidPlayer(player) && (deadPlayerBits(world) & playerBit(player)) !== 0;
}

export function matchEnded(world: World): boolean {
  const rules = matchRules.read(world);
  return rules.participants !== 0 && ((rules.dead | rules.won) & rules.participants) === rules.participants;
}

export function matchOutcome(world: World, player: number): MatchOutcome {
  if (isPlayerDead(world, player)) return 'defeat';
  if (isValidPlayer(player) && (wonPlayerBits(world) & playerBit(player)) !== 0) return 'victory';
  return 'undecided';
}

/** Replace the participant set with the valid slots of `players`; a seat dropped from the set also loses
 *  its dead or won mark. */
export function setMatchParticipants(world: World, players: readonly number[]): void {
  if (!Array.isArray(players)) return; // an imported log carries untyped payloads
  let bits = 0;
  for (const p of players) if (isValidPlayer(p)) bits |= playerBit(p);
  matchRules.write(world, (rules) => {
    rules.participants = bits;
    rules.dead &= bits;
    rules.won &= bits;
  });
}

export function markPlayerDead(world: World, player: number): void {
  if (!isMatchParticipant(world, player)) return;
  matchRules.write(world, (rules) => {
    rules.dead |= playerBit(player);
  });
}

export function markPlayersWon(world: World, bits: number): void {
  matchRules.write(world, (rules) => {
    rules.won = bits & rules.participants;
  });
}
