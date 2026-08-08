/**
 * The `?progression=` URL flag, shared by the menu setting and the game entries. `on` makes the experience
 * tech tree gate professions, overriding a scene built with `progression: false`; `off` gives every settler
 * every civilian trade from the start, though fighters stay barracks-gated. Absent or unrecognized, the
 * world keeps its own rule and no command is enqueued.
 */
export type ProgressionParamValue = 'on' | 'off';

/** The flag's requested enabled state, or null when absent or unrecognized. */
export function progressionOverride(params: URLSearchParams): boolean | null {
  const value = params.get('progression');
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}
