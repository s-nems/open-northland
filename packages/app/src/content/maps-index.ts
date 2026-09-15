import { MapsIndex, type MapsIndexEntry } from '@open-northland/data';
import { diag } from '../diag/log.js';
import { fetchJsonOrNull } from './net.js';

export const MAPS_INDEX_URL = '/maps-index.json';

/** The listing the pipeline wrote, or none: a document this build cannot read lists no maps rather
 *  than a guessed subset. */
export function parseMapsIndex(data: unknown): readonly MapsIndexEntry[] {
  if (data === null) return [];
  const parsed = MapsIndex.safeParse(data);
  if (!parsed.success) {
    diag.warn('content', `maps-index: ${MAPS_INDEX_URL} does not match this build; run the pipeline again`);
    return [];
  }
  return parsed.data;
}

export async function loadMapList(): Promise<readonly MapsIndexEntry[]> {
  return parseMapsIndex(await fetchJsonOrNull<unknown>(MAPS_INDEX_URL));
}
