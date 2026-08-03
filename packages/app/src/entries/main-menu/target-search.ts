import { carriedParams, formatSearch } from '../../view/params.js';
import { DEFAULT_FOG_MODE, LOBBY_FOG_MODES } from './lobby/model.js';

/**
 * Build a launch URL's search: the chosen entry's params layered over the menu's carried settings
 * (`lang`, `uiscale`, ...). Maps default to classic sticky fog when the player picked no mode;
 * scenes keep their own authored fog (a static showcase must stay fully visible, not hide behind
 * reveal fog), still overridable through an explicit `?fog=` choice for either entry kind.
 */
export function targetSearch(entry: string, current = new URLSearchParams(window.location.search)): string {
  const target = carriedParams(current);
  const entryParams = new URLSearchParams(entry.startsWith('?') ? entry.slice(1) : entry);
  for (const [key, value] of entryParams) target.set(key, value);
  const selectedFog = target.get('fog');
  if (entryParams.has('map') && !LOBBY_FOG_MODES.some((mode) => mode === selectedFog))
    target.set('fog', DEFAULT_FOG_MODE);
  return formatSearch(target);
}
