import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapMeta, MapScript, parseTerrainMap, type TerrainMapFile } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { mapChestSpawns } from '../../src/content/map-resources.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * Cross-file invariants between the decoded maps (`<content>/maps/*.json`) and the IR - the seam
 * `parseTerrainMap`'s per-file schema cannot see: a map is only playable when every ground typeId
 * and placed-object name it carries resolves in the SAME pipeline run's ir.json, and every chest it
 * places authors a type the sim's contents table knows. Every map is also run through the real
 * loader's zod parse, so a truncated or lane-skewed emit fails here instead of at first open in the
 * browser. Skips without generated content (see `helpers.ts`).
 */

/** Zod over ~125 maps (~5.5M cells) takes seconds; whichever test parses first pays it once. Sized
 *  as a hang-guard with room for a CPU-contended full parallel run (observed timing out at 60s under
 *  multi-session machine load), not as a benchmark. */
const MAP_PARSE_TIMEOUT_MS = 180_000;

const WOODEN_CHEST_LOGIC_TYPE = 85;
const MAGICAL_CHEST_LOGIC_TYPE = 86;
const UNASSIGNED_MOD_CHEST_TYPE = 13;

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

/** Decoded map grids: a map id is a dotless slug, so a dotted stem is a sidecar (`.meta.json`,
 *  `.script.json`, `.strings.json`, `.briefing.json` carry menu text, the script, the string table and
 *  the briefing, not terrain). */
function mapFiles(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.json') && !f.slice(0, -'.json'.length).includes('.'))
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
    let withMultiplayerTable = 0;
    for (const f of files) {
      const script = MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), f), 'utf8')));
      if (script.players.some((p) => p.type === 'human')) withHumanSeat++;
      if (script.multiplayer !== undefined) withMultiplayerTable++;
    }
    expect(withHumanSeat).toBeGreaterThan(50);
    // ~45 corpus maps author a [multiplayer] lobby table (player.inc/misc.inc/map.ini/map.cif);
    // zero means the section reader silently broke.
    expect(withMultiplayerTable).toBeGreaterThan(30);
  });

  it('every meta sidecar passes the MapMeta schema and most maps carry a maptype', () => {
    const files = readdirSync(mapsDir())
      .filter((f) => f.endsWith('.meta.json'))
      .sort();
    expect(files.length).toBeGreaterThan(100);
    let typed = 0;
    for (const f of files) {
      const meta = MapMeta.parse(JSON.parse(readFileSync(resolve(mapsDir(), f), 'utf8')));
      if (meta.mapTypes !== undefined) typed++;
    }
    // Every corpus map declares a maptype; a run emitting none means the header reader silently
    // broke, which would list every map in every menu.
    expect(typed).toBeGreaterThan(100);
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

  it(
    'the chest join finds both chest records, and every map authors a known type on every chest',
    () => {
      // The sim opens a chest empty when its authored type is not in the contents table, so a gap there
      // turns a treasure into nothing with no symptom.
      const ir = rawIrUnderTest() as ContentIr;
      const chestRecords = (ir.landscapeGfx ?? []).filter(
        (g) => g.logicType === WOODEN_CHEST_LOGIC_TYPE || g.logicType === MAGICAL_CHEST_LOGIC_TYPE,
      );
      expect(chestRecords.map((g) => g.editName).sort()).toEqual(['chest magical', 'chest wooden']);
      let chests = 0;
      const unknown = new Set<number>();
      for (const map of parsedMaps().values()) {
        if (map.objects === undefined) continue;
        for (const chest of mapChestSpawns(map.objects, ir)) {
          chests++;
          if (!systems.CHEST_CONTENTS.has(chest.contents)) unknown.add(chest.contents);
        }
      }
      expect(chests).toBeGreaterThan(0);
      // Ten mod-map chests author type 13, a row the original lacks as well: they open empty
      // there too. Any other unknown type is a table gap.
      expect([...unknown], 'chest types the table does not know').toEqual([UNASSIGNED_MOD_CHEST_TYPE]);
    },
    MAP_PARSE_TIMEOUT_MS,
  );
});
