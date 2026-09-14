import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, TerrainMapFile } from '@open-northland/data';
import {
  components,
  exportSaveGame,
  playerCommand,
  type SimEvent,
  serializeSaveGame,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorld, type MapWorldOptions, restoreMapWorld } from '../../src/entries/map/world.js';
import { mapScriptWorld } from '../../src/game/world/mission-script.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

const MAP_ID = 'wielkie_sprzatanie';
const REINFORCEMENT_MISSION = 51;
const CONTACT_MISSION = 81;
const TRIBUTE_MISSION = 82;
const CONTACT_PAGE = 511;
const FRANK_SEAT = 5;
const ENCOUNTER_MISSION = 22;
/** The mission that hands the player the win, activated only by a later chain of triggers. */
const VICTORY_MISSION = 77;
const ENCOUNTER_PAGE = 501;
const MOVEMENT_BUDGET_TICKS = 2400;

/** A real player's opening and reinforcement route; no verdict or mission state is injected. */
describe.runIf(hasRealIr())('scripted story-map acceptance', () => {
  it('opens contact briefings, reaches reinforcements and a story encounter across restore', async () => {
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
    const scriptFailures: SimEvent[] = [];
    const collectEvents = (): void => {
      for (const event of sim.events.current()) {
        if (event.kind === 'missionCutscene') briefingPages.push(event.page);
        if (event.kind === 'missionUnsupported' || event.kind === 'missionResultFailed')
          scriptFailures.push(event);
      }
    };
    for (let tick = 0; tick < systems.MISSION_EVALUATION_TICKS * 3; tick++) {
      sim.step();
      collectEvents();
    }
    const opening = sim.missions?.missions[0]?.results.find((op) => op.opcode === 'PlayCutscene');
    if (opening?.opcode !== 'PlayCutscene') throw new Error('opening briefing source changed');
    expect(briefingPages).toContain(opening.cutscene);
    const contact = sim.missions?.missions[CONTACT_MISSION];
    expect(contact?.goals).toContainEqual({ opcode: 'PlayerSeen', player: 0, otherPlayer: FRANK_SEAT });
    expect(briefingPages).toContain(CONTACT_PAGE);
    expect(sim.missionStatus()[CONTACT_MISSION]).toMatchObject({ done: true, fireCount: 1 });
    expect(sim.missionStatus()[TRIBUTE_MISSION]).toMatchObject({ visible: true });
    expect(sim.missionBriefingHistory()).toEqual([opening.cutscene, CONTACT_PAGE]);
    expect(components.missionRecords(sim.world)[0]?.fireCount).toBe(1);
    const saved = exportSaveGame(sim, { mapId: MAP_ID });
    const restored = restoreMapWorld(options, saved).sim;
    expect(restored.missionBriefingHistory()).toEqual(sim.missionBriefingHistory());
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
      collectEvents();
      ticks++;
    }
    expect(components.missionRecords(sim.world)[REINFORCEMENT_MISSION]?.fireCount).toBe(1);
    const reinforcements = [...sim.world.query(components.Person)].filter(
      (entity) => !previousHumans.has(entity) && components.ownerOf(sim.world, entity) === 0,
    );
    expect(reinforcements.length).toBeGreaterThanOrEqual(3);
    const encounter = sim.missions?.missions[ENCOUNTER_MISSION]?.goals[0];
    if (encounter?.opcode !== 'FindPosByHumans') throw new Error('story encounter source changed');
    expect(encounter.humanId).toBe(goal.humanId);
    const approach = playerCommand(0, {
      kind: 'moveUnit',
      entity: hero,
      x: encounter.point.hx,
      y: encounter.point.hy,
    });
    sim.enqueue(approach);
    restored.enqueue(approach);
    for (
      let tick = 0;
      tick < MOVEMENT_BUDGET_TICKS && !sim.missionBriefingHistory().includes(ENCOUNTER_PAGE);
      tick++
    ) {
      sim.step();
      restored.step();
      collectEvents();
    }
    expect(sim.missionStatus()[ENCOUNTER_MISSION]).toMatchObject({ done: true, fireCount: 1 });
    expect(briefingPages).toContain(ENCOUNTER_PAGE);
    expect(restored.hashState()).toBe(sim.hashState());
    expect(serializeSaveGame(exportSaveGame(restored, { mapId: MAP_ID }))).toBe(
      serializeSaveGame(exportSaveGame(sim, { mapId: MAP_ID })),
    );
    expect(components.missionRecords(sim.world)[VICTORY_MISSION]?.fireCount ?? 0).toBe(0);
    expect(scriptFailures).toEqual([]);
  }, 90_000);
});
