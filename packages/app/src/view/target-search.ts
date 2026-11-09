import { DEFAULT_FOG_MODE, LOBBY_FOG_MODES } from '../game/fog.js';
import { type CarriedParam, carriedParams, formatSearch } from './params.js';

/** World rules a scene or a campaign mission authors for itself, so a carried menu choice never
 *  reaches one. */
const WORLD_RULE_PARAMS: readonly CarriedParam[] = ['fog', 'progression', 'needs', 'weathermode', 'daynight'];

/**
 * Builds a launch URL's search: the entry's params layered over the menu's carried settings.
 * Maps fall back to the default fog mode; scenes drop the carried rule params so a showcase keeps its
 * own authored values.
 */
export function targetSearch(entry: string, current = new URLSearchParams(window.location.search)): string {
  const entryParams = entrySearchParams(entry);
  return layeredSearch(entryParams, current, entryParams.has('scene'));
}

/** A campaign mission's launch search: the mission plays its map's own rules, whatever the last game
 *  in the menu chose. */
export function missionTargetSearch(
  entry: string,
  current = new URLSearchParams(window.location.search),
): string {
  return layeredSearch(entrySearchParams(entry), current, true);
}

function entrySearchParams(entry: string): URLSearchParams {
  return new URLSearchParams(entry.startsWith('?') ? entry.slice(1) : entry);
}

function layeredSearch(entryParams: URLSearchParams, current: URLSearchParams, ownRules: boolean): string {
  const target = carriedParams(current);
  if (ownRules) for (const key of WORLD_RULE_PARAMS) target.delete(key);
  for (const [key, value] of entryParams) target.set(key, value);
  const selectedFog = target.get('fog');
  if (entryParams.has('map') && !LOBBY_FOG_MODES.some((mode) => mode === selectedFog))
    target.set('fog', DEFAULT_FOG_MODE);
  return formatSearch(target);
}
