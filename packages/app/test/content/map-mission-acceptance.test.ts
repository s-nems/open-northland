import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, TerrainMapFile } from '@open-northland/data';
import { components, exportSaveGame, playerCommand, serializeSaveGame, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorld, type MapWorldOptions, restoreMapWorld } from '../../src/entries/map/world.js';
import { mapScriptWorld } from '../../src/game/world/mission-script.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

const MAP_ID = 'wielkie_sprzatanie';
const REINFORCEMENT_MISSION = 51;
const MOVEMENT_BUDGET_TICKS = 2400;

/** A real player's opening and reinforcement route; no verdict or mission state is injected. */
describe.runIf(hasRealIr())('scripted story-map acceptance', () => {
  it('opens the intact script, reaches its reinforcements and restores the same continuation', async () => {
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
      aiSeats: [],
      assistantSeats: [0],
      script: mapScriptWorld(script, ir),
      fog: null,
      progression: null,
      needs: null,
      missions: null,
      berryBushes: true,
    };
    const { sim } = buildMapWorld(options);
    const mission = sim.missions?.missions[REINFORCEMENT_MISSION];
    const goal = mission?.goals[0];
    if (goal?.opcode !== 'FindPosByHumans') throw new Error('reinforcement route source changed');
    const hero = systems.missionObjects(sim.world, goal.humanId)[0];
    if (hero === undefined) throw new Error('authored hero did not spawn');
    const briefingPages: number[] = [];
    for (let tick = 0; tick < systems.MISSION_EVALUATION_TICKS * 3; tick++) {
      sim.step();
      for (const event of sim.events.current()) {
        if (event.kind === 'missionCutscene') briefingPages.push(event.page);
      }
    }
    const opening = sim.missions?.missions[0]?.results.find((op) => op.opcode === 'PlayCutscene');
    if (opening?.opcode !== 'PlayCutscene') throw new Error('opening briefing source changed');
    expect(briefingPages).toContain(opening.cutscene);
    expect(components.missionRecords(sim.world)[0]?.fireCount).toBe(1);
    const saved = exportSaveGame(sim, { mapId: MAP_ID });
    const restored = restoreMapWorld(options, saved).sim;
    expect(serializeSaveGame(exportSaveGame(restored, { mapId: MAP_ID }))).toBe(serializeSaveGame(saved));
    const order = playerCommand(0, { kind: 'moveUnit', entity: hero, x: goal.point.hx, y: goal.point.hy });
    const previousHumans = new Set(sim.world.query(components.Person));
    sim.enqueue(order);
    restored.enqueue(order);
    let ticks = 0;
    while (
      (components.missionRecords(sim.world)[REINFORCEMENT_MISSION]?.fireCount ?? 0) === 0 &&
      ticks < MOVEMENT_BUDGET_TICKS
    ) {
      sim.step();
      restored.step();
      ticks++;
    }
    expect(components.missionRecords(sim.world)[REINFORCEMENT_MISSION]?.fireCount).toBe(1);
    const reinforcements = [...sim.world.query(components.Person)].filter(
      (entity) => !previousHumans.has(entity) && components.ownerOf(sim.world, entity) === 0,
    );
    expect(reinforcements.length).toBeGreaterThanOrEqual(3);
    if (process.env.ON_ACCEPTANCE_TRACE === '1') {
      console.info('mission-map acceptance', {
        openingTick: components.missionRecords(sim.world)[0]?.firstFiredTick,
        reinforcementTick: components.missionRecords(sim.world)[REINFORCEMENT_MISSION]?.firstFiredTick,
        movementTicks: ticks,
        newAlliedHumans: reinforcements.length,
      });
    }
    expect(restored.hashState()).toBe(sim.hashState());
    expect(serializeSaveGame(exportSaveGame(restored, { mapId: MAP_ID }))).toBe(
      serializeSaveGame(exportSaveGame(sim, { mapId: MAP_ID })),
    );
    expect(components.missionRecords(sim.world)[77]?.fireCount ?? 0).toBe(0);
  }, 90_000);
});
