import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, parseTerrainMap, type TerrainMapFile } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * Cross-file invariants between the decoded maps (`<content>/maps/*.json`) and the IR — the seam
 * `parseTerrainMap`'s per-file schema cannot see: a map is only playable when every ground typeId
 * and placed-object name it carries resolves in the SAME pipeline run's ir.json. Every map is also
 * run through the real loader's zod parse, so a truncated or lane-skewed emit fails here instead of
 * at first open in the browser. Skips without generated content (see `helpers.ts`).
 */

/** Zod over ~125 maps (~5.5M cells) takes seconds; whichever test parses first pays it once. */
const MAP_PARSE_TIMEOUT_MS = 60_000;

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

/** Decoded map files (`.meta.json`/`.script.json` sidecars carry menu text and the player/mission
 *  script, not terrain — excluded). */
function mapFiles(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json') && !f.endsWith('.script.json'))
    .sort();
}

let parsed: ReadonlyMap<string, TerrainMapFile> | null = null;

/** Zod-parse every map once for the whole file (~7s for the full 125-map set). */
function parsedMaps(): ReadonlyMap<string, TerrainMapFile> {
  parsed ??= new Map(
    mapFiles().map((f) => [f, parseTerrainMap(JSON.parse(readFileSync(resolve(mapsDir(), f), 'utf8')))]),
  );
  return parsed;
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))('decoded map invariants', () => {
  it(
    'ships at least one decoded map and every one passes the loader schema',
    () => {
      // parsedMaps() throws on the first schema-invalid file, naming it via the Map construction.
      expect(parsedMaps().size).toBeGreaterThan(0);
    },
    MAP_PARSE_TIMEOUT_MS,
  );

  it(
    'every ground typeId on every map resolves in the same run’s IR landscape table',
    async () => {
      const { real } = await loadContentUnderTest();
      const known = new Set(real.landscape.map((t) => t.typeId));
      for (const [file, map] of parsedMaps()) {
        const unknown = [...new Set(map.typeIds)].filter((t) => !known.has(t));
        expect(unknown, `map ${file} references landscape typeIds absent from ir.json`).toEqual([]);
      }
    },
    MAP_PARSE_TIMEOUT_MS,
  );

  it('every script sidecar passes the MapScript schema and most maps carry a Human slot', () => {
    const files = readdirSync(mapsDir())
      .filter((f) => f.endsWith('.script.json'))
      .sort();
    // The corpus ships playerdata on ~115 of the 125 maps; a run emitting none means the script
    // stage silently broke, not that the sources lost their rosters.
    expect(files.length).toBeGreaterThan(50);
    let withHumanSeat = 0;
    for (const f of files) {
      const script = MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), f), 'utf8')));
      if (script.players.some((p) => p.type === 'human')) withHumanSeat++;
    }
    expect(withHumanSeat).toBeGreaterThan(50);
  });

  it(
    'every placed landscape object name on every map resolves in the IR landscapeGfx table',
    () => {
      // The collision/resource joins key placed objects by their [GfxLandscape] editName; a name the
      // IR lacks silently drops the object (no footprint, no resource) instead of erroring.
      const irRaw = rawIrUnderTest() as { landscapeGfx?: readonly { editName: string }[] };
      const known = new Set((irRaw.landscapeGfx ?? []).map((g) => g.editName));
      expect(known.size).toBeGreaterThan(0);
      for (const [file, map] of parsedMaps()) {
        const unknown = (map.objects?.types ?? []).filter((n) => !known.has(n));
        expect(unknown, `map ${file} places objects absent from ir.json landscapeGfx`).toEqual([]);
      }
    },
    MAP_PARSE_TIMEOUT_MS,
  );
});
