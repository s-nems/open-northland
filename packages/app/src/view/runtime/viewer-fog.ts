import {
  FOG_MODE,
  type FogMode,
  type FogView,
  fogViewOfMask,
  SHARED_SIGHT_VIEWER,
} from '@open-northland/sim';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import type { SessionHost } from '../../session/host.js';

type FogHost = Pick<SessionHost, 'fogView' | 'sharedFogView' | 'fogMode'>;

interface MapSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The fog the viewer draws: none over the whole map, the watched seat's, or under the players' sight
 * the union of `sightSeats`. Until a worker's first answer for the seats lands, the view drawn before
 * stays, or nothing reads seen: an unfogged frame would show the map.
 */
export function viewerFog(
  host: FogHost,
  viewer: ViewerSeat,
  sightSeats: readonly number[],
  mapSize: MapSize,
): () => FogView | null {
  let drawn: FogView | null = null;
  let unseen: FogView | null = null;
  const landed = (view: FogView | null, player: number): FogView | null => {
    if (view !== null) return view;
    const mode = host.fogMode();
    if (mode === FOG_MODE.OFF) return null;
    if (drawn !== null) return drawn;
    if (unseen?.mode !== mode || unseen.player !== player) unseen = unseenFogView(player, mode, mapSize);
    return unseen;
  };
  const next = (): FogView | null => {
    if (viewer.sharedSight() && sightSeats.length > 0)
      return landed(host.sharedFogView(sightSeats), SHARED_SIGHT_VIEWER);
    const seat = viewer.seat();
    return viewer.wholeMap() || seat === null ? null : landed(host.fogView(seat), seat);
  };
  return () => {
    drawn = next();
    return drawn;
  };
}

/**
 * The views whose memories advance while another is drawn: while the session watches, every watchable
 * seat's and the players' sight together, so a switch shows what the new view remembers. A seat whose
 * answer has not landed yet is left out. A played seat draws its own fog and remembers no other.
 */
export function rememberedFog(
  host: FogHost,
  sightSeats: readonly number[],
  watching: () => boolean,
): () => readonly FogView[] {
  const views: FogView[] = [];
  return () => {
    views.length = 0;
    if (!watching() || sightSeats.length === 0) return views;
    for (const seat of sightSeats) {
      const view = host.fogView(seat);
      if (view !== null) views.push(view);
    }
    const shared = host.sharedFogView(sightSeats);
    if (shared !== null) views.push(shared);
    return views;
  };
}

/** Precedes every real answer's generation, so the first answer re-composites every fog layer. */
const UNSEEN_GENERATION = -1;

/** A view of `player` that has seen nothing yet. */
function unseenFogView(player: number, mode: FogMode, mapSize: MapSize): FogView {
  return fogViewOfMask({
    player,
    mode,
    cellsWide: mapSize.width,
    cellsHigh: mapSize.height,
    generation: UNSEEN_GENERATION,
    mask: null,
  });
}
