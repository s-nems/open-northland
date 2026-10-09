import type { DeepReadonly, World } from '../ecs/world.js';
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

/**
 * One row of a multiplayer map's goal table (`docs/formats/MISSIONS.md`, "Multiplayer goals"). Goods are
 * good type ids. `lastStanding` is no authored row: the app adds it where the map's table and script
 * would leave a match nobody can win.
 */
export type MatchGoal =
  | { readonly kind: 'goods'; readonly goods: readonly { readonly good: number; readonly amount: number }[] }
  | { readonly kind: 'inhabitants'; readonly count: number; readonly soldiers: boolean }
  | { readonly kind: 'wonByMission' }
  | { readonly kind: 'lostByMission' }
  | { readonly kind: 'lastStanding' };

export type MatchVictory = 'script' | 'elimination' | 'goals';

/** The most rows a `setMatchParticipants` payload may carry: a bound on an untrusted payload, above
 *  the nineteen a map authors plus the few the app adds. */
export const MAX_MATCH_GOALS = 32;

interface MatchGoalTable {
  /** The seats the table checks: the participants and the seats on the map that cannot die, which
   *  only a row can decide. */
  seats: number;
  goals: MatchGoal[];
  /** Per goal, the players a script's `MissionWon` (a `wonByMission` row) or `MissionFailed` (a
   *  `lostByMission` row) named since the table was set; 0 for every other row. */
  raised: number[];
  /** Participants the table decided, never both: a decided seat is not checked again. */
  won: number;
  lost: number;
}

const matchGoals = defineWorldSingleton<MatchGoalTable & { enabled: boolean }>(
  'MatchGoals',
  'players',
  () => ({
    enabled: false,
    seats: 0,
    goals: [],
    raised: [],
    won: 0,
    lost: 0,
  }),
);

/** The goal table a multiplayer map plays by and the verdicts it reached. */
export const MatchGoals = matchGoals.component;

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
  if (goalsMatchVictory(world)) {
    const goals = matchGoals.read(world);
    return rules.participants !== 0 && ((goals.won | goals.lost) & rules.participants) === rules.participants;
  }
  return (
    rules.participants !== 0 &&
    ((rules.dead | rules.won | wonByScriptBits(world) | lostByScriptBits(world)) & rules.participants) ===
      rules.participants
  );
}

/** A defeat outranks a victory: a seat that died, or that a script failed, has lost whatever else is
 *  marked. A goal table's verdict is the one it reached first, a death included. */
export function matchOutcome(world: World, player: number): MatchOutcome {
  if (!isValidPlayer(player)) return 'undecided';
  const bit = playerBit(player);
  if (goalsMatchVictory(world)) {
    const goals = matchGoals.read(world);
    if ((goals.lost & bit) !== 0) return 'defeat';
    return (goals.won & bit) !== 0 ? 'victory' : 'undecided';
  }
  if (isPlayerDead(world, player) || (lostByScriptBits(world) & bit) !== 0) return 'defeat';
  if (((wonPlayerBits(world) | wonByScriptBits(world)) & bit) !== 0) return 'victory';
  return 'undecided';
}

/** Replace the participant set with the valid slots of `players`; a seat dropped from the set also loses
 *  its dead or won mark. Goals mode plays by `goals`, copied, with no verdict reached yet, over the
 *  participants and `goalSeats`. */
export function setMatchParticipants(
  world: World,
  players: readonly number[],
  victory: MatchVictory = 'elimination',
  goals: readonly MatchGoal[] = [],
  goalSeats: readonly number[] = [],
): void {
  if (!Array.isArray(players)) return; // an imported log carries untyped payloads
  let bits = 0;
  for (const p of players) if (isValidPlayer(p)) bits |= playerBit(p);
  matchRules.write(world, (rules) => {
    rules.participants = bits;
    rules.dead &= bits;
    rules.won &= bits;
    if (victory !== 'elimination') rules.won = 0;
  });
  const enabled = victory === 'script';
  if (scriptedMatchVictory(world) !== enabled) {
    scriptMatchRules.write(world, (rules) => {
      rules.enabled = enabled;
    });
  }
  if (victory === 'goals') {
    const rows = Array.isArray(goals) ? goals : [];
    let seats = bits;
    for (const p of Array.isArray(goalSeats) ? goalSeats : []) if (isValidPlayer(p)) seats |= playerBit(p);
    matchGoals.write(world, (table) => {
      table.enabled = true;
      table.seats = seats;
      table.goals = rows.map(copyGoal);
      table.raised = rows.map(() => 0);
      table.won = 0;
      table.lost = 0;
    });
  } else if (goalsMatchVictory(world)) {
    matchGoals.write(world, (table) => {
      table.enabled = false;
    });
  }
}

function copyGoal(goal: MatchGoal): MatchGoal {
  switch (goal.kind) {
    case 'goods':
      return { kind: 'goods', goods: goal.goods.map(({ good, amount }) => ({ good, amount })) };
    case 'inhabitants':
      return { kind: 'inhabitants', count: goal.count, soldiers: goal.soldiers };
    case 'wonByMission':
    case 'lostByMission':
    case 'lastStanding':
      return { kind: goal.kind };
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

export function goalsMatchVictory(world: World): boolean {
  return matchGoals.read(world).enabled;
}

export function matchGoalTable(world: World): DeepReadonly<MatchGoalTable> {
  return matchGoals.read(world);
}

/** Record that a script's `MissionWon` (`won`) or `MissionFailed` named `player`, on every goal row
 *  that waits for it; the next goal check reads it. A mark already held takes no write. */
export function raiseMissionGoal(world: World, player: number, verdict: 'won' | 'lost'): void {
  if (!isValidPlayer(player)) return;
  const kind = verdict === 'won' ? 'wonByMission' : 'lostByMission';
  const bit = playerBit(player);
  const table = matchGoals.read(world);
  if (!table.goals.some((goal, i) => goal.kind === kind && ((table.raised[i] ?? 0) & bit) === 0)) return;
  matchGoals.write(world, (rows) => {
    rows.goals.forEach((goal, i) => {
      if (goal.kind === kind) rows.raised[i] = (rows.raised[i] ?? 0) | bit;
    });
  });
}

/** Record the goal table's verdict for a seat it has not yet decided. */
export function markGoalVerdict(world: World, player: number, verdict: 'won' | 'lost'): void {
  const bit = playerBit(player);
  const table = matchGoals.read(world);
  if (((table.won | table.lost) & bit) !== 0) return;
  matchGoals.write(world, (rows) => {
    rows[verdict] |= bit;
  });
}

export interface MatchRulesView {
  readonly participants: readonly number[];
  readonly victory: MatchVictory;
  /** Whether the seats left standing win once every rival is out: the skirmish rule, or a goal
   *  table's `lastStanding` row. */
  readonly lastStanding: boolean;
}

export function matchRulesView(world: World): MatchRulesView {
  const goals = goalsMatchVictory(world);
  const victory: MatchVictory = goals ? 'goals' : scriptedMatchVictory(world) ? 'script' : 'elimination';
  return {
    participants: playersOfBits(matchParticipantBits(world)),
    victory,
    lastStanding:
      victory === 'elimination' ||
      (goals && matchGoals.read(world).goals.some((goal) => goal.kind === 'lastStanding')),
  };
}
