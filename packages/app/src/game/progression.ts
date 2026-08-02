/**
 * The `?progression=` URL flag - the profession-progression toggle's app-facing vocabulary, shared by
 * the menu setting and the game entries:
 *
 *  - `on`  - the experience tech tree gates professions (the sim default); an explicit `on` also
 *            overrides a scene built with `progression: false`, mirroring the fog override.
 *  - `off` - every settler knows every civilian trade from the start (fighters stay barracks-gated).
 *
 * Absent or unrecognized, the world keeps whatever it set for itself - and no command is enqueued,
 * so an untouched URL leaves the command stream byte-identical to a pre-toggle run.
 */
export type ProgressionParamValue = 'on' | 'off';

/** The flag's requested enabled-state, or null when absent/unrecognized (keep the world's own rule). */
export function progressionOverride(params: URLSearchParams): boolean | null {
  const value = params.get('progression');
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}
