import type { MapScript } from '@open-northland/data';
import type { MatchRulesView } from '@open-northland/sim';

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

export function hasEliminationGoal(rules: MatchRulesView, player: number): boolean {
  return (
    rules.victory === 'elimination' &&
    matchIsContested(rules.participants) &&
    rules.participants.includes(player)
  );
}
