/**
 * The one home for `window.location.search` handling, shared by the app entries and the menu-to-game
 * launch, so no entry re-declares its own parser.
 */

/** The player-facing settings that survive a menu/game switch; every other param is dropped. The
 *  `?uiscale` diagnostic pin is deliberately not carried: sticky, it would mask the scale setting. */
export const CARRIED_PARAMS = [
  'lang',
  'speed',
  'fog',
  'progression',
  'needs',
  'weathermode',
  'sound',
  'debug',
] as const;
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

/** The world and seat selection a save records so a menu load can relaunch the session; carried
 *  settings and diagnostic pins stay out, so a relaunch takes those from the player's own session. */
const ENTRY_PARAMS = ['map', 'scene', 'player', 'colors', 'tribes', 'ai', 'seed'] as const;

export function entrySearch(current = new URLSearchParams(window.location.search)): string | null {
  const target = new URLSearchParams();
  for (const key of ENTRY_PARAMS) {
    const value = current.get(key);
    if (value !== null) target.set(key, value);
  }
  const search = formatSearch(target);
  return search === '' ? null : search;
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

/** The `?postfx` session override for the stored post-fx setting; `null` when absent. */
export function postFxParam(params: URLSearchParams): boolean | null {
  const raw = params.get('postfx');
  return raw === null ? null : raw !== 'off';
}

/**
 * Parse a `?<name>=<seat>[,<seat>...]` seat list, such as `?ai=`, the seats handed to the strategic AI
 * player when a map starts. Malformed entries are dropped.
 */
export function seatListParam(params: URLSearchParams, name: 'ai' | 'absent'): number[] {
  const raw = params.get(name);
  if (raw === null) return [];
  const seats: number[] = [];
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part, 10);
    if (Number.isInteger(n) && n >= 0 && !seats.includes(n)) seats.push(n);
  }
  return seats;
}

/** `?intro=off` skips automatic briefing windows, including script chapters, for captures and probes. */
export function introParam(params: URLSearchParams): boolean {
  return params.get('intro') !== 'off';
}

/** A `?weather=` value: one kind over the whole map at an amount in percent, `clear`, or `ambient`,
 *  the game's own weather held at a percent of a light episode: 200 is heavy, 300 a storm. */
export interface WeatherParam {
  readonly kind: 'rain' | 'snow' | 'sand' | 'clear' | 'ambient';
  readonly percent: number;
}

const WEATHER_PARAM_KINDS = ['rain', 'snow', 'sand', 'clear', 'ambient'] as const;
/** The amount a bare `?weather=<kind>` shows: a heavy script shower, near the storm threshold. */
const WEATHER_PARAM_DEFAULT_PERCENT = 30;
/** A bare `?weather=ambient` holds the strongest light episode; the scale ends at a full storm. */
const WEATHER_PARAM_AMBIENT_PERCENT = 100;
const WEATHER_PARAM_AMBIENT_MAX_PERCENT = 300;
const PERCENT_FULL = 100;

/** `?weather=<rain|snow|sand|clear|ambient>[:<percent>]` overrides the map's weather in this view only, for
 *  captures and visual review; the sim's weather state is untouched. */
export function weatherParam(params: URLSearchParams): WeatherParam | null {
  const raw = params.get('weather');
  if (raw === null) return null;
  const [name, amount] = raw.split(':');
  const kind = WEATHER_PARAM_KINDS.find((k) => k === name);
  if (kind === undefined) return null;
  const bare = kind === 'ambient' ? WEATHER_PARAM_AMBIENT_PERCENT : WEATHER_PARAM_DEFAULT_PERCENT;
  const parsed = amount === undefined ? bare : Number.parseFloat(amount);
  if (!Number.isFinite(parsed)) return null;
  const max = kind === 'ambient' ? WEATHER_PARAM_AMBIENT_MAX_PERCENT : PERCENT_FULL;
  return { kind, percent: Math.min(max, Math.max(0, parsed)) };
}
