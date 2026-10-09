import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript } from '@open-northland/data';
import { createHumanPaletteColours, createHumanPaletteIdentity } from '@open-northland/render';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { DEFAULT_PALETTE } from '../../src/content/settler-gfx/index.js';
import { humanPaletteBook } from '../../src/content/sprite-sheet/human-palettes.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';
import { realMapPath, realMapScript, realMapWorld } from './real-map-world.js';

/** A map whose `[misc_humangraphics]` dresses its placed hero Bjarni (mission id 201) as a viking woman
 *  in red, and names an id (202) no placed human carries. */
const INVASION_MAP_ID = 'wielka_inwazja';
const BJARNI_ID = 201;
const UNPLACED_ID = 202;
const SCRIPT_SUFFIX = '.script.json';

describe.runIf(hasRealIr())("a map's [misc_humangraphics] looks", () => {
  it('name only recipes the humanPalettes lane carries, across every map that writes one', () => {
    const lane = (rawIrUnderTest() as { humanPalettes: { recipes: { name: string }[] } }).humanPalettes;
    const recipes = new Set(lane.recipes.map((r) => r.name));
    const mapsDir = resolve(contentDir(), 'maps');
    const unknown: string[] = [];
    let rows = 0;
    for (const file of readdirSync(mapsDir).filter((f) => f.endsWith(SCRIPT_SUFFIX))) {
      const script = MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir, file), 'utf8')));
      for (const { recipe } of script.humanPalettes) {
        rows++;
        if (!recipes.has(recipe)) unknown.push(`${file}: ${recipe}`);
      }
    }
    expect(rows).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  it.runIf(existsSync(realMapPath(INVASION_MAP_ID)))(
    'dress the placed humans carrying the id, and their palettes change',
    async () => {
      const authored = realMapScript(INVASION_MAP_ID)?.humanPalettes ?? [];
      const bjarniRecipes = authored.filter((r) => r.humanId === BJARNI_ID).map((r) => r.recipe);
      expect(bjarniRecipes.length).toBeGreaterThan(0);
      expect(authored.some((r) => r.humanId === UNPLACED_ID)).toBe(true);

      const { sim, ir } = await realMapWorld({ mapId: INVASION_MAP_ID, aiSeats: [] });
      const dressed = [...sim.world.query(components.ScriptedLook)];
      expect(dressed.length).toBeGreaterThan(0);
      for (const e of dressed) {
        expect(sim.world.get(e, components.MissionObjectId).id).toBe(BJARNI_ID);
        expect(sim.world.get(e, components.ScriptedLook).recipes).toEqual(bjarniRecipes);
      }

      const book = humanPaletteBook(ir as ContentIr);
      if (book === undefined) throw new Error('the IR carries no composable human palettes');
      const look = { body: DEFAULT_PALETTE, head: DEFAULT_PALETTE, random: [] };
      const plain = createHumanPaletteColours();
      book.compose(createHumanPaletteIdentity(look), plain);
      const scripted = createHumanPaletteColours();
      book.compose(Object.assign(createHumanPaletteIdentity(look), { scripted: bjarniRecipes }), scripted);
      expect(scripted.body).not.toEqual(plain.body);
    },
  );
});
