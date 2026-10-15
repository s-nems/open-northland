import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type BobsIndexEntry, CampaignIndex, type MapsIndexEntry } from '@open-northland/data';
import { mapsIndexEntry } from '@open-northland/map-import';
import { statIfExists } from '../files.js';
import { BOBS_DIR, writeJsonFile } from './content-tree.js';
import type { MapDatConversion } from './maps/index.js';

export const MAPS_INDEX_FILE = 'maps-index.json';
export const BOBS_INDEX_FILE = 'bobs-index.json';
export const CAMPAIGNS_INDEX_FILE = 'campaigns-index.json';

/** The base pack installs no campaign; the private campaign build replaces this file in its output. */
const EMPTY_CAMPAIGNS_INDEX: CampaignIndex = CampaignIndex.parse({ version: 3, campaigns: [] });

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

/** Writes the listings the app reads instead of scanning the tree. */
export async function writeListings(outDir: string, maps: readonly MapDatConversion[]): Promise<void> {
  await writeJsonFile(outDir, MAPS_INDEX_FILE, mapsIndexEntries(maps));
  await writeJsonFile(outDir, BOBS_INDEX_FILE, await bobsIndexEntries(outDir));
  await writeJsonFile(outDir, CAMPAIGNS_INDEX_FILE, EMPTY_CAMPAIGNS_INDEX);
}
