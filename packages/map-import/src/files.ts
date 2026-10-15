import type { ConvertedMap } from './convert.js';

/** The file name suffixes of one map's documents under `maps/`, each after the map id. */
export const MAP_FILE_SUFFIXES = {
  terrain: '.json',
  meta: '.meta.json',
  strings: '.strings.json',
  script: '.script.json',
  briefing: '.briefing.json',
  picture: '.png',
  minimap: '.map.png',
} as const;

/** Every fixed file name a map with this id can own under `maps/`; its voices' names vary. */
export function mapFileNames(id: string): string[] {
  return Object.values(MAP_FILE_SUFFIXES).map((suffix) => `${id}${suffix}`);
}

/** One JSON document as the content tree stores it: compact, newline-terminated. Compact because a
 *  terrain's lanes are hundreds of thousands of numbers, and one per line costs about 8x the size. */
function jsonFile(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** The files one map owns under `maps/`, by file name, exactly as the content tree serves them. */
export function mapFiles(map: ConvertedMap): Map<string, string | Uint8Array> {
  const files = new Map<string, string | Uint8Array>();
  files.set(`${map.id}${MAP_FILE_SUFFIXES.terrain}`, jsonFile(map.terrain));
  if (map.strings !== undefined) files.set(`${map.id}${MAP_FILE_SUFFIXES.strings}`, jsonFile(map.strings));
  files.set(`${map.id}${MAP_FILE_SUFFIXES.meta}`, jsonFile(map.meta));
  if (map.script !== undefined) files.set(`${map.id}${MAP_FILE_SUFFIXES.script}`, jsonFile(map.script));
  if (map.briefing !== undefined) files.set(`${map.id}${MAP_FILE_SUFFIXES.briefing}`, jsonFile(map.briefing));
  if (map.picture !== undefined) files.set(`${map.id}${MAP_FILE_SUFFIXES.picture}`, map.picture);
  if (map.minimap !== undefined) files.set(`${map.id}${MAP_FILE_SUFFIXES.minimap}`, map.minimap);
  for (const [suffix, wav] of map.voices) files.set(`${map.id}${suffix}`, wav);
  return files;
}
