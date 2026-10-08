import { FNV_OFFSET_BASIS, fnvHex, fnvMixWord, terrainGridFingerprint } from '@open-northland/data';
import type { TerrainMap } from '../nav/terrain/index.js';

/** Dynamic landscape inputs shape navigation and must match when restoring sparse edits. */
export function mapFingerprint(map: TerrainMap): string {
  const ground = terrainGridFingerprint(map);
  if (
    map.landscapes === undefined &&
    map.landVertices === undefined &&
    map.groundEdges === undefined &&
    map.waterContinents === undefined &&
    map.fishSwarms === undefined &&
    map.tints === undefined
  )
    return ground;
  const input = JSON.stringify(
    {
      ground,
      landscapes: map.landscapes,
      landVertices: map.landVertices,
      waterContinents: map.waterContinents,
      fishSwarms: map.fishSwarms,
      tints: map.tints,
    },
    (_key, value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    },
  );
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) hash = fnvMixWord(hash, input.charCodeAt(i));
  // Mixed raw: a typed array would stringify as an object keyed by index.
  const edges = map.groundEdges ?? [];
  for (let i = 0; i < edges.length; i++) hash = fnvMixWord(hash, edges[i] ?? 0);
  return fnvHex(hash);
}
