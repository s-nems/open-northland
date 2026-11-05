import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, TerrainMapFile } from '@open-northland/data';
import {
  components,
  exportSaveGame,
  hexDistanceBetween,
  nodeOfPosition,
  playerCommand,
  type SimEvent,
  serializeSaveGame,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { buildMapWorld, type MapWorldOptions, restoreMapWorld } from '../../../src/entries/map/world.js';
import { mapScriptWorld } from '../../../src/game/world/mission-script.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from '../helpers.js';

const MAP_ID = 'wielkie_sprzatanie_2_0';
const CONTACT_MISSION = 1;
const TRIBUTE_MISSION = 3;
const CONTACT_PAGE = 511;
const FRANK_SEAT = 5;
/** Sigurd's walk to the Sphinx, which lays the chests around it (a chest that fails to lay is a script failure). */
const SPHINX_MISSION = 18;
const SPHINX_PAGE = 503;
/** The pigeon chest, which a closed friendly wall ring surrounds. */
const PIGEON_CHEST_MISSION = 4;
const PIGEON_CHEST_PAGE = 501;
/** Hex distance from the pigeon chest to the ring's nearest wall segments; a larger one lies outside. */
const WALL_RING_RADIUS = 3;
/** The mission that hands the player the win, activated only by a later chain of triggers. */
const VICTORY_MISSION = 46;
const MOVEMENT_BUDGET_TICKS = 2400;

/** A real player's opening, contact and Sphinx route; no verdict or mission state is injected. */
describe.runIf(hasRealIr())('scripted story-map acceptance', () => {
  it('opens contact briefings and reaches the Sphinx encounter across restore, but not the walled pigeon chest', async () => {
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
      machineSeats: [],
      assistantSeats: [0],
      script: mapScriptWorld(script, ir),
      fog: null,
      progression: null,
      needs: null,
      alliedVision: null,
      peace: null,
      missions: null,
      berryBushes: true,
    };
    const { sim } = buildMapWorld(options);
    const goal = sim.missions?.missions[SPHINX_MISSION]?.goals[0];
    if (goal?.opcode !== 'FindPosByHumans') throw new Error('Sphinx route source changed');
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
    sim.enqueue(order);
    let ticks = 0;
    while (
      (components.missionRecords(sim.world)[SPHINX_MISSION]?.fireCount ?? 0) === 0 &&
      ticks < MOVEMENT_BUDGET_TICKS
    ) {
      sim.step();
      collectEvents();
      ticks++;
    }
    expect(components.missionRecords(sim.world)[SPHINX_MISSION]?.fireCount).toBe(1);
    expect(briefingPages).toContain(SPHINX_PAGE);
    const chest = sim.missions?.missions[PIGEON_CHEST_MISSION]?.goals[0];
    if (chest?.opcode !== 'ChestNearPos') throw new Error('pigeon chest source changed');
    // The loaded map's friendly wall ring leaves no connected walking route to the chest.
    const approach = playerCommand(0, {
      kind: 'moveUnit',
      entity: hero,
      x: chest.point.hx,
      y: chest.point.hy,
    });
    sim.enqueue(approach);
    for (let tick = 0; tick < MOVEMENT_BUDGET_TICKS; tick++) {
      sim.step();
      collectEvents();
    }
    // The hero gave the walk up rather than still being on its way.
    expect(sim.world.has(hero, components.MoveGoal)).toBe(false);
    expect(sim.world.has(hero, components.PathFollow)).toBe(false);
    expect(sim.world.has(hero, components.PathRequest)).toBe(false);
    const heroAt = sim.world.get(hero, components.Position);
    const heroNode = nodeOfPosition(heroAt.x, heroAt.y);
    expect(hexDistanceBetween(heroNode.hx, heroNode.hy, chest.point.hx, chest.point.hy)).toBeGreaterThan(
      WALL_RING_RADIUS,
    );
    expect(sim.missionStatus()[PIGEON_CHEST_MISSION]).toMatchObject({ done: false, fireCount: 0 });
    expect(briefingPages).not.toContain(PIGEON_CHEST_PAGE);
    expect(components.missionRecords(sim.world)[VICTORY_MISSION]?.fireCount ?? 0).toBe(0);
    expect(scriptFailures).toEqual([]);
  }, 90_000);
});
