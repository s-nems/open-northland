import { type CarriedParam, carriedParams, formatSearch } from '../../view/params.js';
import { DEFAULT_FOG_MODE, LOBBY_FOG_MODES } from './lobby/model.js';

/** World rules a scene authors for itself, so a carried menu choice never reaches one. */
const SCENE_OWNED_PARAMS: readonly CarriedParam[] = ['fog', 'progression', 'needs'];

/**
 * Builds a launch URL's search: the entry's params layered over the menu's carried settings.
 * Maps fall back to the default fog mode; scenes drop the carried rule params so a showcase keeps its
 * own authored values.
 */
export function targetSearch(entry: string, current = new URLSearchParams(window.location.search)): string {
  const target = carriedParams(current);
  const entryParams = new URLSearchParams(entry.startsWith('?') ? entry.slice(1) : entry);
  if (entryParams.has('scene')) for (const key of SCENE_OWNED_PARAMS) target.delete(key);
  for (const [key, value] of entryParams) target.set(key, value);
  const selectedFog = target.get('fog');
  if (entryParams.has('map') && !LOBBY_FOG_MODES.some((mode) => mode === selectedFog))
    target.set('fog', DEFAULT_FOG_MODE);
  return formatSearch(target);
}
