import type { MapMultiplayerGoal, MapScript } from '@open-northland/data';
import type { MatchGoal, MatchRulesView } from '@open-northland/sim';
import type { MapScriptWorld } from './world/build.js';

const NEVER_DIES_KEY = 'playerneverdies';

/** The seats the script's `[playermisc] playerneverdies` rows exempt from dying. */
export function neverDiesSeats(script: Pick<MapScript, 'misc'>): number[] {
  const seats: number[] = [];
  for (const line of script.misc) {
    if (line.key !== NEVER_DIES_KEY) continue;
    const seat = Number.parseInt(line.values[0] ?? '', 10);
    if (Number.isInteger(seat) && seat >= 0 && !seats.includes(seat)) seats.push(seat);
  }
  return seats.sort((a, b) => a - b);
}

/** Whether a declared list makes a match at all: with one seat there is nobody to beat, so the rule
 *  decides nothing and the sheet promises no skirmish goal. */
export function matchIsContested(participants: readonly number[]): boolean {
  return new Set(participants).size >= 2;
}

export function matchParticipants(input: {
  readonly controlled: readonly number[];
  readonly aiSeats: readonly number[];
  readonly neverDies: readonly number[];
}): number[] {
  const seats = new Set<number>([...input.controlled, ...input.aiSeats]);
  for (const seat of input.neverDies) seats.delete(seat);
  return [...seats].sort((a, b) => a - b);
}

export function scriptMatchParticipants(script: Pick<MapScript, 'players' | 'misc'>): number[] {
  return matchParticipants({
    controlled: script.players.map((row) => row.player),
    aiSeats: [],
    neverDies: neverDiesSeats(script),
  });
}

/**
 * Whether the match counts the script's roster rather than the session's seats: where a script verdict
 * decides, the script names whom it decides for. Original behavior: a goal table checks every seat on
 * the map. A lobby session drives every such seat, so its seats are that set; approximation: a local
 * run leaves the seats it does not drive out of the table.
 */
export function scriptDecidesRoster(world: Pick<MapScriptWorld, 'victory' | 'scriptVerdicts'>): boolean {
  return world.victory === 'script' || (world.victory === 'goals' && world.scriptVerdicts === true);
}

export function hasEliminationGoal(rules: MatchRulesView, player: number): boolean {
  return rules.lastStanding && matchIsContested(rules.participants) && rules.participants.includes(player);
}

/**
 * The goal table a multiplayer map's match plays by: the authored `[misc_multiplayer_goals]` rows,
 * then the rows this build adds where the table leaves the script's verdicts unread. Original
 * behavior: a `MissionWon` or `MissionFailed` no row waits for decides nothing in a multiplayer game,
 * and no row lets the last seats standing win. Approximation: a verdict the script names still decides
 * without its row, and where the script names neither and no row counts goods or people, the seats
 * left standing win once every rival is out, so no corpus map is left a match nobody can win.
 */
export function multiplayerMatchGoals(
  authored: readonly MapMultiplayerGoal[],
  verdicts: { readonly won: boolean; readonly failed: boolean },
): MatchGoal[] {
  const authors = (kind: MapMultiplayerGoal['kind']): boolean => authored.some((goal) => goal.kind === kind);
  const goals: MatchGoal[] = [...authored];
  if (verdicts.won && !authors('wonByMission')) goals.push({ kind: 'wonByMission' });
  if (verdicts.failed && !authors('lostByMission')) goals.push({ kind: 'lostByMission' });
  if (!verdicts.won && !verdicts.failed && !authors('goods') && !authors('inhabitants')) {
    goals.push({ kind: 'lastStanding' });
  }
  return goals;
}
