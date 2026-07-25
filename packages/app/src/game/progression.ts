/**
 * The `?progression=` URL flag — the profession-progression toggle's app-facing vocabulary, shared by
 * the menu setting and the game entries:
 *
 *  - `on`  (or absent) — the experience tech tree gates professions (the sim default).
 *  - `off` — every settler knows every civilian trade from the start (fighters stay barracks-gated);
 *            the entry enqueues `setProfessionProgression false` at world build.
 */
export type ProgressionParamValue = 'on' | 'off';

/** Whether `?progression=off` asks for the free-start mode; any other value keeps the default. */
export function progressionDisabled(params: URLSearchParams): boolean {
  return params.get('progression') === 'off';
}
