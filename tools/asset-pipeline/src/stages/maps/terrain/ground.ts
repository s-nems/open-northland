import { decodeStringListChunk, findChunk, unpackX6elLayer } from '../../../decoders/mapdat/index.js';
import { compactDictionary, type DecodedMap } from './lane.js';

export interface GroundLayer {
  readonly patterns: string[];
  readonly a: number[];
  readonly b: number[];
}

/**
 * Decodes the `empa`/`empb` per-cell ground-pattern lanes and the `eapd` dictionary into each cell's
 * two triangle indices over a compacted per-map pattern-name list. Returns undefined when the map
 * lacks any of the three chunks; throws on an index outside the dictionary.
 */
export function groundFromMapDat({ map, size }: DecodedMap): GroundLayer | undefined {
  const empa = findChunk(map, 'empa');
  const empb = findChunk(map, 'empb');
  const eapd = findChunk(map, 'eapd');
  if (empa === undefined || empb === undefined || eapd === undefined) return undefined;
  const names = decodeStringListChunk(eapd);
  const laneA = unpackX6elLayer(empa).cells;
  const laneB = unpackX6elLayer(empb).cells;
  const cells = size.width * size.height;
  if (laneA.length !== cells || laneB.length !== cells) {
    throw new Error(`mapdat: empa/empb lanes have ${laneA.length}/${laneB.length} cells, expected ${cells}`);
  }
  const { names: patterns, remap } = compactDictionary([laneA, laneB], names, {
    lane: 'empa/empb',
    noun: 'pattern',
    dict: 'eapd',
  });
  return { patterns, a: remap(laneA), b: remap(laneB) };
}
