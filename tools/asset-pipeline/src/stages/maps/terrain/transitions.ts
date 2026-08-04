import { TRANSITION_NONE, TRANSITION_PAIRS } from '@open-northland/data';
import { decodeStringListChunk, findChunk, unpackMapLayer } from '../../../decoders/mapdat/index.js';
import type { DecodedMap } from './lane.js';

export interface TransitionsLayer {
  readonly types: string[];
  readonly a1: number[];
  readonly b1: number[];
  readonly a2: number[];
  readonly b2: number[];
}

/**
 * Decodes the `emt1..emt4` per-cell transition-overlay lanes and the `eatd` dictionary verbatim: the
 * `⌊v/6⌋` join is positional, so compacting the ids could collide with the `TRANSITION_NONE` sentinel.
 * Returns undefined when the map lacks any of the five chunks; throws on a length mismatch or an
 * out-of-dictionary value.
 */
export function transitionsFromMapDat({ map, size }: DecodedMap): TransitionsLayer | undefined {
  const eatd = findChunk(map, 'eatd');
  if (eatd === undefined) return undefined;
  const cells = size.width * size.height;
  const types = decodeStringListChunk(eatd);
  const decodeLane = (tag: string): number[] | undefined => {
    const chunk = findChunk(map, tag);
    if (chunk === undefined) return undefined;
    const lane = unpackMapLayer(chunk).cells;
    if (lane.length !== cells) {
      throw new Error(`mapdat: ${tag} lane has ${lane.length} cells, expected ${cells}`);
    }
    for (const v of lane) {
      if (v !== TRANSITION_NONE && Math.floor(v / TRANSITION_PAIRS) >= types.length) {
        throw new Error(
          `mapdat: ${tag} value ${v} references transition ${Math.floor(v / TRANSITION_PAIRS)} outside the ${types.length}-entry eatd dictionary`,
        );
      }
    }
    return Array.from(lane);
  };
  // Four named lanes prove the arity by construction, without a tuple cast.
  const a1 = decodeLane('emt1');
  const b1 = decodeLane('emt2');
  const a2 = decodeLane('emt3');
  const b2 = decodeLane('emt4');
  if (a1 === undefined || b1 === undefined || a2 === undefined || b2 === undefined) return undefined;
  return { types, a1, b1, a2, b2 };
}
