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
 * Decodes the `emt1..emt4` per-cell transition-overlay lanes + the `eatd` transition-name dictionary.
 * Each lane is one u8 per cell (row-major, length === width·height — same resolution as `empa`/`empb`,
 * confirmed on the real maps); `255` = no overlay, `v < 255` selects transition `⌊v/6⌋` from the
 * dictionary and pair variant `v % 6` of its six UV pairs. The lanes and the dictionary are carried
 * verbatim (no compaction — the ⌊v/6⌋ join is positional, and re-encoding packed values could collide
 * with the 255 sentinel). Source basis in docs/SOURCES.md "terrain tessellation". Returns undefined
 * when the map lacks any of the five chunks; throws on a length mismatch or an out-of-dictionary value.
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
  // Naming the four lanes proves the arity by construction (no tuple cast); any missing lane omits the layer.
  const a1 = decodeLane('emt1');
  const b1 = decodeLane('emt2');
  const a2 = decodeLane('emt3');
  const b2 = decodeLane('emt4');
  if (a1 === undefined || b1 === undefined || a2 === undefined || b2 === undefined) return undefined;
  return { types, a1, b1, a2, b2 };
}
