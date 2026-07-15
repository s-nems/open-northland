/**
 * URL query-param helpers shared by the app entries (`?zoom` / `?speed` / `?cols` / `?seed` / `?ticks`)
 * and the menu↔game navigation. The one home for `window.location.search` handling, so an entry never
 * re-declares its own copy (the parsers used to drift — `?cols` demanded `> 0`, `?seed`/`?ticks` allowed
 * `>= 0`; that split is now the `min` argument of {@link intParam}).
 */

/** The player-facing settings that carry between the menu and a running game — kept across a scene/map
 *  switch (menu → game, {@link import('../entries/menu/settings.js').targetSearch}) and a quit back to
 *  the menu ({@link menuSearch}). Everything else (the entry selector `scene`/`map`/…) is dropped. */
export const CARRIED_PARAMS = ['lang', 'uiscale', 'speed', 'fog', 'debug'] as const;
export type CarriedParam = (typeof CARRIED_PARAMS)[number];

/** Copy just the {@link CARRIED_PARAMS} settings out of a search into a fresh params bag. */
export function carriedParams(current = new URLSearchParams(window.location.search)): URLSearchParams {
  const target = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = current.get(key);
    if (value !== null) target.set(key, value);
  }
  return target;
}

/** Render a params bag as a `?…` search string, or `''` when empty (a bare navigation). */
export function formatSearch(params: URLSearchParams): string {
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/** The search for returning to the main menu from a running game: the carried settings kept, the
 *  entry-selecting flags (`scene`/`map`/…) dropped, so quit-to-menu lands on the default menu entry with
 *  the player's settings intact. The inverse of the menu's `targetSearch`. */
export function menuSearch(current = new URLSearchParams(window.location.search)): string {
  return formatSearch(carriedParams(current));
}

/** Parse a positive-float URL param (e.g. `?zoom=4`), falling back when absent or invalid (`<= 0` / NaN). */
export function floatParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parse an integer URL param (e.g. `?cols=6`) clamped to `>= min` (default 0); falls back when absent or invalid. */
export function intParam(params: URLSearchParams, name: string, fallback: number, min = 0): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= min ? n : fallback;
}
