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
 * The match state the `setMatchParticipants` command opens and the MatchSystem drives. Kept
 * apart from the other rule singletons so declaring a match never materializes them.
 */
export const MatchRules = matchRules.component;

const scriptMatchRules = defineWorldSingleton<{ enabled: boolean }>('ScriptMatchRules', 'players', () => ({
  enabled: false,
}));
export const ScriptMatchRules = scriptMatchRules.component;

const scriptVerdicts = defineWorldSingleton<{
  /** Players a script's `MissionWon` named. */
  won: number;
  /** Players a script's `MissionFailed` named; their commands stay accepted (approximation). */
  lost: number;
}>('ScriptVerdicts', 'players', () => ({ won: 0, lost: 0 }));

/** The outcome a map script declares, apart from the skirmish rule: any valid slot, participant or
 *  not, since a campaign map decides for whoever it names. */
export const ScriptVerdicts = scriptVerdicts.component;

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

/** The skirmish rule's winners; a non-zero set is a decided match, and a script's verdicts are not
 *  part of it because the death check keeps running after a scripted win (reading). */
export function wonPlayerBits(world: World): number {
  return matchRules.read(world).won;
}

export function wonByScriptBits(world: World): number {
  return scriptVerdicts.read(world).won;
}

export function lostByScriptBits(world: World): number {
  return scriptVerdicts.read(world).lost;
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
  return (
    rules.participants !== 0 &&
    ((rules.dead | rules.won | wonByScriptBits(world) | lostByScriptBits(world)) & rules.participants) ===
      rules.participants
  );
}

/** A defeat outranks a victory: a seat that died, or that a script failed, has lost whatever else is
 *  marked. */
export function matchOutcome(world: World, player: number): MatchOutcome {
  if (!isValidPlayer(player)) return 'undecided';
  const bit = playerBit(player);
  if (isPlayerDead(world, player) || (lostByScriptBits(world) & bit) !== 0) return 'defeat';
  if (((wonPlayerBits(world) | wonByScriptBits(world)) & bit) !== 0) return 'victory';
  return 'undecided';
}

/** Replace the participant set with the valid slots of `players`; a seat dropped from the set also loses
 *  its dead or won mark. */
export function setMatchParticipants(
  world: World,
  players: readonly number[],
  victory: 'script' | 'elimination' = 'elimination',
): void {
  if (!Array.isArray(players)) return; // an imported log carries untyped payloads
  let bits = 0;
  for (const p of players) if (isValidPlayer(p)) bits |= playerBit(p);
  matchRules.write(world, (rules) => {
    rules.participants = bits;
    rules.dead &= bits;
    rules.won &= bits;
    if (victory === 'script') rules.won = 0;
  });
  const enabled = victory === 'script';
  if (scriptedMatchVictory(world) !== enabled) {
    scriptMatchRules.write(world, (rules) => {
      rules.enabled = enabled;
    });
  }
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

/** Record a script's verdict for `player`. A mark already held takes no write. */
export function markScriptVerdict(world: World, player: number, verdict: 'won' | 'lost'): void {
  if (!isValidPlayer(player)) return;
  const bit = playerBit(player);
  if ((scriptVerdicts.read(world)[verdict] & bit) !== 0) return;
  scriptVerdicts.write(world, (verdicts) => {
    verdicts[verdict] |= bit;
  });
}

export function scriptedMatchVictory(world: World): boolean {
  return scriptMatchRules.read(world).enabled;
}

export interface MatchRulesView {
  readonly participants: readonly number[];
  readonly victory: 'script' | 'elimination';
}

export function matchRulesView(world: World): MatchRulesView {
  return {
    participants: playersOfBits(matchParticipantBits(world)),
    victory: scriptedMatchVictory(world) ? 'script' : 'elimination',
  };
}
