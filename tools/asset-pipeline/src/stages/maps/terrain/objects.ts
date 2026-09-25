import {
  decodeStringListChunk,
  findChunk,
  unpackMapLayer,
  unpackX6elLayer,
} from '../../../decoders/mapdat/index.js';
import { compactDictionary, type DecodedMap } from './lane.js';

/** The `emla` lane's "no object here" sentinel (u16 max). */
const EMLA_EMPTY = 0xffff;
/** The `lmlp` byte for an unowned placement; every other corpus value is a player slot 0..12. */
const LMLP_NEUTRAL = 0xff;
const LMLP_MAX_PLAYER = 12;

export interface ObjectsLayer {
  readonly types: string[];
  readonly placements: number[];
  readonly levels?: number[];
  readonly owners?: Array<number | null>;
}

/**
 * Decodes the `emla` half-cell landscape-object lane and the `eald` dictionary into a sparse flat
 * `[hx, hy, typeIndex]` triple list in row-major half-cell order, over a compacted per-map type-name
 * list. The sibling `lmlv` lane's per-placement level is emitted as a parallel `levels` array, omitted
 * when the map lacks the lane. The sibling `lmlp` lane is likewise reduced to one owner per placement,
 * preserving its 255 neutral sentinel as `null`. Returns undefined when either object chunk is missing;
 * throws on a dictionary index, lane length or owner byte outside its verified range.
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
  const lmlp = findChunk(map, 'lmlp');
  const ownerLane = lmlp !== undefined ? unpackMapLayer(lmlp).cells : undefined;
  if (ownerLane !== undefined && ownerLane.length !== lane.length) {
    throw new Error(`mapdat: lmlp lane has ${ownerLane.length} half-cells, expected ${lane.length}`);
  }
  const { names: types, indexOf } = compactDictionary([lane], names, {
    lane: 'emla',
    noun: 'object',
    dict: 'eald',
    skip: EMLA_EMPTY,
  });
  const placements: number[] = [];
  const levels: number[] = [];
  const owners: Array<number | null> = [];
  for (let hy = 0; hy < hh; hy++) {
    for (let hx = 0; hx < hw; hx++) {
      const i = hy * hw + hx;
      const v = lane[i] as number;
      if (v === EMLA_EMPTY) continue;
      placements.push(hx, hy, indexOf(v));
      if (stateLane !== undefined) levels.push(stateLane[i] as number);
      if (ownerLane !== undefined) {
        const owner = ownerLane[i] as number;
        if (owner !== LMLP_NEUTRAL && owner > LMLP_MAX_PLAYER) {
          throw new Error(
            `mapdat: lmlp owner ${owner} at half-cell (${hx},${hy}) is outside player slots 0..${LMLP_MAX_PLAYER} or neutral 255`,
          );
        }
        owners.push(owner === LMLP_NEUTRAL ? null : owner);
      }
    }
  }
  return {
    types,
    placements,
    ...(stateLane === undefined ? {} : { levels }),
    ...(ownerLane === undefined ? {} : { owners }),
  };
}
