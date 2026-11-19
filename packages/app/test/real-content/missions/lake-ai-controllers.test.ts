import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, TerrainMapFile } from '@open-northland/data';
import { components, exportSaveGame, serializeSaveGame, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { buildMapWorld, type MapWorldOptions, restoreMapWorld } from '../../../src/entries/map/world.js';
import { mapScriptWorld } from '../../../src/game/world/mission-script.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from '../helpers.js';

const MAP_ID = 'the_lake_of_the_mists';
const SEATS = [1, 2];
/** Synthetic reinforcement only: fifty men satisfy both authored task minimums at their 100:150 weights. */
const REINFORCEMENTS = 50;

// Real map, real AI definitions and the normal app world builder; no long economic opening is simulated.
describe.runIf(hasRealIr())('Lake of the Mists controller coexistence', () => {
  it('runs authored defence and attack alongside autonomous decisions and preserves both controllers across restore', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { merge } = await loadContentUnderTest();
    const root = resolve(contentDir(), 'maps');
    const map = TerrainMapFile.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.json`), 'utf8')));
    const script = MapScript.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.script.json`), 'utf8')));
    const options: MapWorldOptions = {
      seed: 7,
      map,
      ir,
      content: { content: merge.content },
      machineSeats: SEATS,
      assistantSeats: [0],
      script: mapScriptWorld(script, ir),
      fog: null,
      progression: null,
      needs: null,
      alliedVision: null,
      peace: null,
      storageCapacity: null,
      missions: false,
      berryBushes: true,
    };
    const { sim } = buildMapWorld(options);
    const soldier = sim.content.jobs.find((job) => job.id === 'soldier_spear_wooden');
    const terrain = sim.terrain;
    if (soldier === undefined || terrain === undefined) throw new Error('missing soldier or map terrain');
    for (const seat of SEATS) {
      const row = script.ai.find((entry) => entry.player === seat);
      const position = row?.defaultPosition;
      const player = script.players.find((entry) => entry.player === seat);
      if (row === undefined || position === undefined || player === undefined)
        throw new Error('missing map AI seat');
      expect(row.allDisabled).toBe(false);
      expect(row.computerDisabled).toBe(false);
      expect(row.disabledComputerModules).toEqual([]);
      expect(row.tasks.map((task) => task.kind)).toEqual(['defend', 'attack']);
      let spawned = 0;
      for (let dy = -10; dy <= 10 && spawned < REINFORCEMENTS; dy++) {
        for (let dx = -10; dx <= 10 && spawned < REINFORCEMENTS; dx++) {
          const x = position.x + dx;
          const y = position.y + dy;
          if (!terrain.inBounds(x, y) || !terrain.isWalkable(terrain.nodeAt(x, y))) continue;
          sim.enqueueSetup({
            kind: 'spawnSettler',
            owner: seat,
            tribe: player.tribeId,
            jobType: soldier.typeId,
            x,
            y,
          });
          spawned++;
        }
      }
      expect(spawned).toBe(REINFORCEMENTS);
    }
    sim.run(2 * systems.AI_HANDLER_ROUND_TICKS);
    for (const seat of SEATS) {
      const control = components.aiControlEntity(sim.world, seat);
      const state = components.mapAiEntity(sim.world, seat);
      if (control === null || state === null) throw new Error('missing running controller');
      expect(sim.world.get(control, components.AiControl)).toMatchObject({
        computerEnabled: true,
        mapAiEnabled: true,
      });
      expect(components.computerModuleRuns(sim.world, seat, 'military')).toBe(true);
      const program = sim.world.get(state, components.MapAiState);
      expect(program.soldiers.some((record) => record.task === 0)).toBe(true);
      expect(program.soldiers.some((record) => record.task === 1)).toBe(true);
      const orders = sim.commands.log.filter((entry) => entry.origin === 'ai' && entry.player === seat);
      expect(
        orders.some(
          (entry) =>
            entry.origin === 'ai' &&
            entry.decisionSource === 'map-ai' &&
            ['setStance', 'attackMoveUnit', 'attackUnit'].includes(entry.command.kind),
        ),
      ).toBe(true);
      expect(
        orders.some(
          (entry) =>
            entry.origin === 'ai' &&
            entry.decisionSource !== undefined &&
            entry.decisionSource !== 'map-ai' &&
            entry.decisionSource !== 'settlement-defence',
        ),
      ).toBe(true);
    }
    expect(
      sim.commands.log.some(
        (entry) =>
          entry.origin === 'ai' &&
          entry.player === 1 &&
          entry.decisionSource === 'map-ai' &&
          entry.command.kind === 'attackMoveUnit',
      ),
    ).toBe(true);
    const saved = exportSaveGame(sim, { mapId: MAP_ID });
    const restored = restoreMapWorld(options, saved).sim;
    expect(restored.hashState()).toBe(sim.hashState());
    expect(serializeSaveGame(exportSaveGame(restored, { mapId: MAP_ID }))).toBe(serializeSaveGame(saved));
    expect(sim.checkInvariants()).toEqual([]);
    expect(restored.checkInvariants()).toEqual([]);
  }, 120_000);
});
