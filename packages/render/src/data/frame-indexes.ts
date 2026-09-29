import { entitiesWith, type WorldSnapshot } from '@open-northland/sim';
import { hudTotalsOf } from './hud/totals.js';
import {
  enterableStoresOf,
  palisadesOf,
  roadNetworkOf,
  siegeShotsOf,
  targetPositionsOf,
} from './scene/snapshot-index.js';

/** One per-frame read that registers snapshot indexes on a mirror; `seat` is the viewer the HUD counts
 *  for, null for an observer. */
export interface FrameIndexReader {
  readonly name: string;
  read(snapshot: WorldSnapshot, seat: number | null): void;
}

/** The indexes render's frame reads over a developed map: the HUD totals, the scene's lookups and the
 *  vehicles the fog ghosts forget once sighted. A bench registers them to measure the runtime's
 *  per-delta upkeep; a reader added to the frame belongs here too. */
export const RENDER_FRAME_INDEX_READERS: readonly FrameIndexReader[] = [
  {
    name: 'HUD totals',
    read: (snapshot, seat) => {
      if (seat !== null) hudTotalsOf(snapshot, seat);
    },
  },
  { name: 'enterable stores', read: (snapshot) => enterableStoresOf(snapshot) },
  { name: 'wanted targets', read: (snapshot) => targetPositionsOf(snapshot) },
  { name: 'palisades', read: (snapshot) => palisadesOf(snapshot) },
  { name: 'siege shots', read: (snapshot) => siegeShotsOf(snapshot) },
  { name: 'fog ghost vehicles', read: (snapshot) => entitiesWith(snapshot, 'Vehicle') },
  { name: 'road network', read: (snapshot) => roadNetworkOf(snapshot) },
];
