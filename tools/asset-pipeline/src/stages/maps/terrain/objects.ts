import {
  decodeStringListChunk,
  findChunk,
  unpackMapLayer,
  unpackX6elLayer,
} from '../../../decoders/mapdat/index.js';
import { compactDictionary, type DecodedMap } from './lane.js';

/** The `emla` lane's "no object here" sentinel (u16 max). */
const EMLA_EMPTY = 0xffff;

export interface ObjectsLayer {
  readonly types: string[];
  readonly placements: number[];
  readonly levels?: number[];
}

/**
 * Decodes the `emla` half-cell landscape-object lane + the `eald` object-name dictionary into a sparse
 * flat `[hx, hy, typeIndex]` triple list (row-major half-cell scan order — deterministic) over a
 * compacted per-map type-name list. This is every pre-placed tree/stone/bush/mine decal/wave the map
 * ships; a name joins onto the extracted `[GfxLandscape]` table (`LandscapeGfx.editName`). The sibling
 * `lmlv` byte lane carries each placement's level — 1-based, counting up from the lowest state (level 1
 * = sapling/dregs, level N = full-grown/full/intact) onto the record's highest-first `GfxFrames` lists,
 * so consumers map `index = N − level` (a wall's `100` sentinel = intact) — emitted as a parallel
 * `levels` array (omitted when the map lacks the lane). Returns undefined when the map lacks either
 * object chunk; throws on an index outside the dictionary.
 */
export function objectsFromMapDat({ map, size }: DecodedMap): ObjectsLayer | undefined {
  const emla = findChunk(map, 'emla');
  const eald = findChunk(map, 'eald');
  if (emla === undefined || eald === undefined) return undefined;
  const names = decodeStringListChunk(eald);
  const lane = unpackX6elLayer(emla).cells;
  const hw = size.width * 2;
  const hh = size.height * 2;
  if (lane.length !== hw * hh) {
    throw new Error(`mapdat: emla lane has ${lane.length} half-cells, expected ${hw * hh}`);
  }
  const lmlv = findChunk(map, 'lmlv');
  const stateLane = lmlv !== undefined ? unpackMapLayer(lmlv).cells : undefined;
  if (stateLane !== undefined && stateLane.length !== lane.length) {
    throw new Error(`mapdat: lmlv lane has ${stateLane.length} half-cells, expected ${lane.length}`);
  }
  const { names: types, indexOf } = compactDictionary([lane], names, {
    lane: 'emla',
    noun: 'object',
    dict: 'eald',
    skip: EMLA_EMPTY,
  });
  const placements: number[] = [];
  const levels: number[] = [];
  for (let hy = 0; hy < hh; hy++) {
    for (let hx = 0; hx < hw; hx++) {
      const i = hy * hw + hx;
      const v = lane[i] as number;
      if (v === EMLA_EMPTY) continue;
      placements.push(hx, hy, indexOf(v));
      if (stateLane !== undefined) levels.push(stateLane[i] as number);
    }
  }
  return stateLane !== undefined ? { types, placements, levels } : { types, placements };
}
