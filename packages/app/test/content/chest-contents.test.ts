import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTerrainMap } from '@open-northland/data';
import { components, Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { mapChestSpawns } from '../../src/content/map-resources.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/** Zod over the whole map set takes seconds; a hang-guard, not a benchmark. */
const MAP_PARSE_TIMEOUT_MS = 180_000;

const WOODEN_CHEST_LOGIC_TYPE = 85;
const MAGICAL_CHEST_LOGIC_TYPE = 86;
const UNASSIGNED_MOD_CHEST_TYPE = 13;

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

/** Decoded map grids only: a dotted stem is a sidecar, not terrain. */
function mapFiles(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.json') && !f.slice(0, -'.json'.length).includes('.'))
    .sort();
}

const { CHEST_CONTENTS, createChest, resolveChestReward } = systems;
const { Chest, ResourceFootprint } = components;
const CHEST_KIND_BY_LOGIC_TYPE = [
  ['wooden', WOODEN_CHEST_LOGIC_TYPE],
  ['magical', MAGICAL_CHEST_LOGIC_TYPE],
] as const;

/**
 * Pin the chest-contents table against the real extracted content. The sim opens a chest empty when a
 * reward's slug is unknown, so a typo turns a treasure into nothing with no symptom - every slug the
 * table names must resolve, and the chest landscape records the map join keys on must be there.
 */
describe.runIf(hasRealIr())('chest contents against real content', () => {
  it('every reward slug and animal tribe resolves, so no known chest type opens empty', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    for (const [type, reward] of CHEST_CONTENTS) {
      if (reward.kind === 'vehicle') continue; // the catapult chest is a named gap
      for (const kind of ['wooden', 'magical'] as const) {
        expect(resolveChestReward(content, kind, type).kind, `chest type ${type} (${kind})`).not.toBe(
          'nothing',
        );
      }
    }
  });

  it('the sim resolves each kind to its record, so a map chest draws and blocks by that record', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const sim = new Simulation({ seed: 1, content });
    for (const [kind, logicType] of CHEST_KIND_BY_LOGIC_TYPE) {
      const record = content.landscapeGfx.find((g) => g.logicType === logicType);
      if (record === undefined) throw new Error(`no ${kind} chest record`);
      const e = createChest(sim.world, content, { kind, contents: 0, x: 4, y: 4, gfxIndex: record.index });
      expect(sim.world.get(e, Chest).gfxIndex, kind).toBe(record.index);
      expect(sim.world.get(e, ResourceFootprint).sourceGfxIndex, kind).toBe(record.index);
      expect(sim.world.get(e, ResourceFootprint).walk.length, kind).toBeGreaterThan(0);
    }
  });

  it.runIf(existsSync(resolve(contentDir(), 'maps')))(
    'the map join finds both chest records, and every decoded map authors a known type on every chest',
    () => {
      const ir = rawIrUnderTest() as ContentIr;
      const chestRecords = (ir.landscapeGfx ?? []).filter(
        (g) => g.logicType === WOODEN_CHEST_LOGIC_TYPE || g.logicType === MAGICAL_CHEST_LOGIC_TYPE,
      );
      expect(chestRecords.map((g) => g.editName).sort()).toEqual(['chest magical', 'chest wooden']);
      let chests = 0;
      const unknown = new Set<number>();
      for (const file of mapFiles()) {
        const map = parseTerrainMap(JSON.parse(readFileSync(resolve(mapsDir(), file), 'utf8')));
        if (map.objects === undefined) continue;
        for (const chest of mapChestSpawns(map.objects, ir)) {
          chests++;
          if (!CHEST_CONTENTS.has(chest.contents)) unknown.add(chest.contents);
        }
      }
      expect(chests).toBeGreaterThan(0);
      // Ten mod-map chests author type 13, a row the original's dispatch lacks as well: they open empty
      // there too. Any other unknown type is a table gap.
      expect([...unknown], 'chest types the table does not know').toEqual([UNASSIGNED_MOD_CHEST_TYPE]);
    },
    MAP_PARSE_TIMEOUT_MS,
  );
});
