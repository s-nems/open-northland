import { type FrameIndexReader, RENDER_FRAME_INDEX_READERS } from '@open-northland/render/data';
import { entitiesWith, positionedWithin, type TileBox } from '@open-northland/sim';
import {
  actorsOf,
  fatherOf,
  homeFamiliesOf,
  isAdult,
  isBuilding,
  isSettler,
  needsRuleEnabled,
  staffOf,
} from '../../game/snapshot.js';
import { computeSettlerBubbles } from './settler-bubbles.js';

/** A box holding no tile: a read that only registers the position index. */
const NO_TILES: TileBox = { minX: 0, minY: 0, maxX: -1, maxY: -1 };
/** An id no entity takes: a read that only registers its index. */
const NO_ENTITY = -1;

/** Every snapshot index a running game's frame keeps on its mirror over a developed map, one entry per
 *  reader: render's, then the HUD messages' and the projections'. A bench registers them to measure the
 *  runtime's per-delta upkeep; a reader added to the frame belongs here too. */
export const FRAME_INDEX_READERS: readonly FrameIndexReader[] = [
  ...RENDER_FRAME_INDEX_READERS,
  { name: 'needs rule', read: (snapshot) => needsRuleEnabled(snapshot) },
  { name: 'actors', read: (snapshot) => actorsOf(snapshot) },
  { name: 'construction signs', read: (snapshot) => entitiesWith(snapshot, 'UnderConstruction') },
  { name: 'settler bubbles', read: (snapshot) => computeSettlerBubbles(snapshot) },
  { name: 'position buckets', read: (snapshot) => positionedWithin(snapshot, NO_TILES) },
  { name: 'staff', read: (snapshot) => staffOf(snapshot, NO_ENTITY) },
  {
    name: 'families',
    // The grouping registers on the first home anybody lives in, as a door badge's read does; a one-off
    // walk, so the split measures no other index.
    read: (snapshot) => {
      for (const e of snapshot.entities) {
        if (isBuilding(e) && homeFamiliesOf(snapshot, e.id) !== undefined) return;
      }
    },
  },
  {
    name: 'parents',
    // A notice naming a child reads its father once; the same one-off walk finds the first child.
    read: (snapshot) => {
      for (const e of snapshot.entities) {
        if (isSettler(e) && !isAdult(e)) {
          fatherOf(snapshot, e);
          return;
        }
      }
    },
  },
];
