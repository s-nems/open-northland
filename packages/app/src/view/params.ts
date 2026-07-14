/**
 * URL query-param parsers shared by the app entries (`?zoom` / `?speed` / `?cols` / `?seed` / `?ticks`).
 * The one home for `window.location.search` number parsing, so an entry never re-declares its own copy
 * (they used to drift — `?cols` demanded `> 0`, `?seed`/`?ticks` allowed `>= 0`; that split is now the
 * `min` argument of {@link intParam}).
 */

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
