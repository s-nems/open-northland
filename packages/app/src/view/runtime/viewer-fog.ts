import {
  FOG_MODE,
  type FogMode,
  type FogView,
  fogViewOfMask,
  SHARED_SIGHT_VIEWER,
} from '@open-northland/sim';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import type { SessionHost } from '../../session/host.js';

/**
 * The fog the viewer draws: none over the whole map, the watched seat's, or under the players' sight
 * the union of `sightSeats`. Until a worker's first union lands nothing reads seen, since an unfogged
 * frame would show the map.
 */
export function viewerFog(
  host: Pick<SessionHost, 'fogView' | 'sharedFogView' | 'fogMode'>,
  viewer: ViewerSeat,
  sightSeats: readonly number[],
  mapSize: { readonly width: number; readonly height: number },
): () => FogView | null {
  let unseen: FogView | null = null;
  const sharedFog = (): FogView | null => {
    const view = host.sharedFogView(sightSeats);
    if (view !== null) return view;
    const mode = host.fogMode();
    if (mode === FOG_MODE.OFF) return null;
    if (unseen?.mode !== mode) unseen = unseenFogView(mode, mapSize);
    return unseen;
  };
  return () => {
    if (viewer.sharedSight() && sightSeats.length > 0) return sharedFog();
    const seat = viewer.seat();
    return viewer.wholeMap() || seat === null ? null : host.fogView(seat);
  };
}

/** Precedes every real answer's generation, so the first answer re-composites every fog layer. */
const UNSEEN_GENERATION = -1;

/** A shared view nobody has seen anything of yet. */
function unseenFogView(mode: FogMode, mapSize: { readonly width: number; readonly height: number }): FogView {
  return fogViewOfMask({
    player: SHARED_SIGHT_VIEWER,
    mode,
    cellsWide: mapSize.width,
    cellsHigh: mapSize.height,
    generation: UNSEEN_GENERATION,
    mask: null,
  });
}
