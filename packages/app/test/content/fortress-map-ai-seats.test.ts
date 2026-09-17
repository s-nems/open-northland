import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, TerrainMapFile } from '@open-northland/data';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorld, type MapWorldOptions } from '../../src/entries/map/world.js';
import { mapScriptWorld } from '../../src/game/world/mission-script.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

const MAP_ID = 'specjalna_forteca';
/** The besieged fortress and its six raiding seats, all `HAI_Disable`d by the map. */
const FORTRESS_SEATS = [6, 7, 8, 9, 10, 11, 12];
/** The vikings' computer allies, which the map leaves to the full strategic player. */
const ALLY_SEATS = [1, 2, 3, 4, 5];
/** Ticks covering every seat's first strategic decision. */
const FIRST_DECISIONS_TICKS = 48;

describe.runIf(hasRealIr())('the fortress map’s authored AI seats', () => {
  it('leaves the fortress without a strategic brain and its allies with one', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { merge } = await loadContentUnderTest();
    const root = resolve(contentDir(), 'maps');
    const map = TerrainMapFile.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.json`), 'utf8')));
    const script = MapScript.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.script.json`), 'utf8')));
    expect(script.ai.map((row) => row.player)).toEqual(FORTRESS_SEATS);
    const options: MapWorldOptions = {
      seed: 7,
      map,
      ir,
      content: { content: merge.content },
      aiSeats: [...ALLY_SEATS, ...FORTRESS_SEATS],
      assistantSeats: [0],
      script: mapScriptWorld(script, ir),
      fog: null,
      progression: null,
      needs: null,
      missions: null,
      berryBushes: true,
    };
    const { sim } = buildMapWorld(options);
    sim.step();
    for (const seat of FORTRESS_SEATS) {
      expect(components.isAiPlayer(sim.world, seat)).toBe(true);
      expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(sim.world, seat, id))).toBe(false);
    }
    for (const seat of ALLY_SEATS) {
      expect(components.AI_MODULE_IDS.every((id) => components.aiModuleRuns(sim.world, seat, id))).toBe(true);
    }
    // The fortress mans its towers but marches nobody out: a raid on the besiegers is the campaign
    // the map switched off.
    sim.run(FIRST_DECISIONS_TICKS);
    const fortressOrders = sim.commands.log.filter(
      (entry) => entry.origin === 'ai' && FORTRESS_SEATS.includes(entry.player),
    );
    expect(fortressOrders.some((entry) => entry.command.kind === 'assignWorker')).toBe(true);
    expect(fortressOrders.some((entry) => entry.command.kind === 'attackMoveUnit')).toBe(false);
    expect(fortressOrders.some((entry) => entry.command.kind === 'placeBuilding')).toBe(false);
  }, 60_000);
});
