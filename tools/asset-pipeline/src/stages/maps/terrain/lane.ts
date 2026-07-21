import type { MapDat, MapDatSize } from '../../../decoders/mapdat/index.js';

/** One decoded `map.dat`: the chunk container + its `lsiz` grid dims, threaded to every lane decoder. */
export interface DecodedMap {
  readonly map: MapDat;
  readonly size: MapDatSize;
}

/** A compacted dictionary: the used names in ascending source-id order + the remap onto them. */
export interface CompactedDictionary {
  readonly names: string[];
  /** The `names` index for one source id collected from the lanes. */
  readonly indexOf: (id: number) => number;
  /** Remaps a whole lane onto `names` indices, preserving order and length. */
  readonly remap: (lane: Iterable<number>) => number[];
}

/**
 * Compacts a lane's dictionary: collect the ids the lanes actually use, order them ascending, and
 * remap them onto a dense list of names. Ascending source-id order is load-bearing — it is the
 * emitted layer's join key onto the extracted tables, so a re-run stays byte-identical. `skip` is the
 * lane's empty sentinel, if it has one. Throws (`mapdat:` prefix) on an id outside `names`.
 */
export function compactDictionary(
  lanes: readonly Iterable<number>[],
  names: readonly string[],
  what: { readonly lane: string; readonly noun: string; readonly dict: string; readonly skip?: number },
): CompactedDictionary {
  const used = new Set<number>();
  for (const lane of lanes) {
    for (const v of lane) if (v !== what.skip) used.add(v);
  }
  const indexById = new Map<number, number>();
  const compacted: string[] = [];
  for (const id of [...used].sort((x, y) => x - y)) {
    const name = names[id];
    if (name === undefined) {
      throw new Error(
        `mapdat: ${what.lane} ${what.noun} id ${id} outside the ${names.length}-entry ${what.dict} dictionary`,
      );
    }
    indexById.set(id, compacted.length);
    compacted.push(name);
  }
  const indexOf = (id: number): number => {
    const index = indexById.get(id);
    if (index === undefined) {
      throw new Error(`mapdat: ${what.lane} ${what.noun} id ${id} was not collected from the lanes`);
    }
    return index;
  };
  return { names: compacted, indexOf, remap: (lane) => Array.from(lane, indexOf) };
}
