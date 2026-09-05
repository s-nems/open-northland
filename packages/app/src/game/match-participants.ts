import type { MapScript } from '@open-northland/data';

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

/**
 * The seats that play the match: the controlled seat and the AI seats, minus the never-dying ones.
 * A read-only observer controls no seat, so only the AI seats play. Ascending, deduplicated.
 */
export function matchParticipants(input: {
  readonly controlled: readonly number[];
  readonly aiSeats: readonly number[];
  readonly neverDies: readonly number[];
}): number[] {
  const seats = new Set<number>([...input.controlled, ...input.aiSeats]);
  for (const seat of input.neverDies) seats.delete(seat);
  return [...seats].sort((a, b) => a - b);
}
