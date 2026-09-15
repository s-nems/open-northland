import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type BobsIndexEntry, type MapsIndexEntry, mapLobbySlots } from '@open-northland/data';
import { statIfExists } from '../files.js';
import { BOBS_DIR, writeJsonFile } from './content-tree.js';
import type { MapDatConversion } from './maps/index.js';

export const MAPS_INDEX_FILE = 'maps-index.json';
export const BOBS_INDEX_FILE = 'bobs-index.json';

/** Code-unit order: the one string order every JavaScript host agrees on. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One entry per converted map id, the last conversion of a repeated id winning like its files did. */
export function mapsIndexEntries(maps: readonly MapDatConversion[]): MapsIndexEntry[] {
  const byId = new Map<string, MapsIndexEntry>();
  for (const map of maps) byId.set(map.id, mapsIndexEntry(map));
  return [...byId.values()].sort((a, b) => byCodeUnit(a.id, b.id));
}

function mapsIndexEntry(map: MapDatConversion): MapsIndexEntry {
  const { provenance, campaign, name, description, mapTypes, multiplayerOnly } = map.meta;
  const players = map.script === undefined ? [] : mapLobbySlots(map.script);
  return {
    id: map.id,
    ...(provenance === undefined ? {} : { provenance }),
    ...(campaign === undefined ? {} : { campaign }),
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    minimap: map.minimap,
    ...(players.length > 0 ? { players } : {}),
    ...(map.script?.multiplayer?.fixedColors === true ? { fixedColors: true } : {}),
    ...(mapTypes === undefined ? {} : { mapTypes }),
    ...(multiplayerOnly === true ? { multiplayerOnly: true } : {}),
  };
}

/** Every viewable atlas under `bobs/`: a `<stem>.png` + `<stem>.atlas.json` pair, sorted by (base, variant). */
export async function bobsIndexEntries(outDir: string): Promise<BobsIndexEntry[]> {
  const bobs = join(outDir, BOBS_DIR);
  if (!(await statIfExists(bobs))?.isDirectory()) return [];
  const names = new Set(await readdir(bobs));
  return (
    [...names]
      .filter((name) => name.endsWith('.atlas.json'))
      .map((name) => name.slice(0, -'.atlas.json'.length))
      // An `.indexed` sheet holds a palette index in red and a mask in alpha, not a viewable image.
      .filter((stem) => !stem.endsWith('.indexed'))
      .filter((stem) => names.has(`${stem}.png`))
      .map((stem) => {
        const dot = stem.indexOf('.');
        const base = dot === -1 ? stem : stem.slice(0, dot);
        const variant = dot === -1 ? '' : stem.slice(dot + 1);
        return { stem, base, variant };
      })
      .sort((a, b) => byCodeUnit(a.base, b.base) || byCodeUnit(a.variant, b.variant))
  );
}

/** Writes the two listings the app reads instead of scanning the tree. */
export async function writeListings(outDir: string, maps: readonly MapDatConversion[]): Promise<void> {
  await writeJsonFile(outDir, MAPS_INDEX_FILE, mapsIndexEntries(maps));
  await writeJsonFile(outDir, BOBS_INDEX_FILE, await bobsIndexEntries(outDir));
}
