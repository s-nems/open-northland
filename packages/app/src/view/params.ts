/**
 * The one home for `window.location.search` handling, shared by the app entries and the menu-to-game
 * navigation, so no entry re-declares its own parser.
 */

/** The player-facing settings that survive a menu/game switch; every other param is dropped. */
export const CARRIED_PARAMS = ['lang', 'uiscale', 'speed', 'fog', 'progression', 'sound', 'debug'] as const;
export type CarriedParam = (typeof CARRIED_PARAMS)[number];

export function carriedParams(current = new URLSearchParams(window.location.search)): URLSearchParams {
  const target = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = current.get(key);
    if (value !== null) target.set(key, value);
  }
  return target;
}

export function formatSearch(params: URLSearchParams): string {
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/** The search for quitting to the main menu: carried settings kept, entry-selecting flags dropped. */
export function menuSearch(current = new URLSearchParams(window.location.search)): string {
  return formatSearch(carriedParams(current));
}

/** Parse a positive-float URL param, falling back when it is absent or invalid. */
export function floatParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parse an integer URL param, falling back when it is absent or below `min`. */
export function intParam(params: URLSearchParams, name: string, fallback: number, min = 0): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

/**
 * Parse `?ai=<seat>[,<seat>...]`, the seats handed to the strategic AI player when a map starts.
 * Malformed entries are dropped.
 */
export function aiSeatsParam(params: URLSearchParams): number[] {
  const raw = params.get('ai');
  if (raw === null) return [];
  const seats: number[] = [];
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part, 10);
    if (Number.isInteger(n) && n >= 0 && !seats.includes(n)) seats.push(n);
  }
  return seats;
}
