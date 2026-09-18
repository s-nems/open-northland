import type { TerrainMapFile } from '@open-northland/data';
import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import { exportSaveGame, type MissionScript, type SimEvent, SUCCESSFUL_IF } from '@open-northland/sim';
import { expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildMapWorld, restoreMapWorld } from '../src/entries/map/world.js';
import { BRIEFING_PAGE, presentationScene } from '../src/scenes/presentation.js';
import { createSceneWorld, enableSceneScript } from '../src/scenes/runtime.js';

/**
 * A scripted world opens on its briefing: each entry's boot hands over a world whose first live tick
 * runs the script's load pass, so the frame loop collects the opening `PlayCutscene`. A sub-mission
 * reaches the player as a save taken at boot, and its first tick after the restore does the same.
 */

const MAP_SIDE = 12;
const PAGE = 500;

const map: TerrainMapFile = {
  width: MAP_SIDE,
  height: MAP_SIDE,
  typeIds: new Array<number>(MAP_SIDE * MAP_SIDE).fill(0),
};
const missions: MissionScript = {
  missions: [
    {
      active: true,
      visible: true,
      successfullIf: SUCCESSFUL_IF.all,
      goals: [],
      results: [{ opcode: 'PlayCutscene', cutscene: PAGE, replay: true }],
    },
  ],
};
const options = {
  seed: 7,
  map,
  ir: {} as ContentIr,
  content: {},
  aiSeats: [],
  assistantSeats: [],
  fog: null,
  progression: null,
  needs: null,
  missions: null,
  script: { missions },
};
const OPENING: SimEvent = { kind: 'missionCutscene', mission: 0, page: PAGE, replay: true };

it('fires the opening briefing on the first tick after boot, not inside it', () => {
  const { sim } = buildMapWorld(options);
  expect(sim.missionBriefingHistory()).toEqual([]);
  sim.step();
  expect(sim.events.current()).toContainEqual(OPENING);
  expect(sim.missionBriefingPage()).toBe(PAGE);
});

it('fires it on the first tick after a save taken at boot is restored', () => {
  const { sim } = buildMapWorld(options);
  const { sim: restored } = restoreMapWorld(options, exportSaveGame(sim, { mapId: 'child' }));
  restored.step();
  expect(restored.events.current()).toContainEqual(OPENING);
});

it('keeps the script off under ?missions=off', () => {
  const { sim } = buildMapWorld({ ...options, missions: false });
  sim.step();
  expect(sim.events.current()).not.toContainEqual(OPENING);
  expect(sim.missionBriefingHistory()).toEqual([]);
});

it('fires a scene briefing on the first tick after the scene entry`s boot tick', () => {
  const sim = createSceneWorld(presentationScene);
  const driver = new LockstepDriver({ sim, transport: new LoopbackTransport() });
  driver.runTick(); // the entry frames its camera on this tick's spawns
  enableSceneScript(sim, presentationScene);
  expect(sim.missionBriefingHistory()).toEqual([]);
  driver.runTick();
  expect(sim.events.current()).toContainEqual({
    kind: 'missionCutscene',
    mission: 0,
    page: BRIEFING_PAGE,
    replay: true,
  });
});
