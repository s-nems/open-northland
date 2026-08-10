import { SCENE_TOKEN_PREFIX } from './world-names.js';

/** The world token a launch search selects, in the form a save header records it. */
function worldTokenOf(search: URLSearchParams): string | null {
  const scene = search.get('scene');
  if (scene !== null) return `${SCENE_TOKEN_PREFIX}${scene}`;
  return search.get('map');
}

/**
 * The search that relaunches a save's session: its recorded entry when that selects the save's own
 * world, else one rebuilt from the world token alone (a v1 save, or an entry naming another world),
 * which loses the seat but boots the world the save actually holds. Null when it names no world.
 */
export function relaunchSearch(header: {
  readonly mapId: string | null;
  readonly entry: string | null;
}): string | null {
  if (header.entry !== null) {
    const recorded = new URLSearchParams(header.entry.startsWith('?') ? header.entry.slice(1) : header.entry);
    if (worldTokenOf(recorded) === header.mapId) return header.entry;
  }
  if (header.mapId === null) return null;
  return header.mapId.startsWith(SCENE_TOKEN_PREFIX)
    ? `?scene=${encodeURIComponent(header.mapId.slice(SCENE_TOKEN_PREFIX.length))}`
    : `?map=${encodeURIComponent(header.mapId)}`;
}
