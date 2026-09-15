import { components, exportSaveGame, restoreSimulation, SUCCESSFUL_IF, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { resolveAuthoredPlacements, runAuthoredMap } from '../src/game/world/index.js';
import { AUTHORED_ROWS } from './support/authored-entities.js';
import { authoredMap } from './support/world-maps.js';

const PLAYER = 0;
const POINT = { hx: 3, hy: 5 };
const entities = {
  buildings: [],
  humans: [],
  animals: [],
  guides: [
    { player: PLAYER, ...POINT },
    { player: PLAYER, hx: POINT.hx + 1, hy: POINT.hy },
  ],
};

it('loads a guide-only map, preserving nearby authored posts and mission detection after restore', () => {
  const map = authoredMap();
  const missions = {
    missions: [
      {
        active: true,
        visible: true,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [{ opcode: 'DetectGuide' as const, player: PLAYER, point: POINT, range: 0 }],
        results: [],
      },
    ],
  };
  const sim = runAuthoredMap(1, 0, map, entities, AUTHORED_ROWS, {}, { missions });
  if (sim === null) throw new Error('Guide-only map was dropped');
  sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
  sim.run(systems.MISSION_EVALUATION_TICKS);
  expect([...sim.world.query(components.Signpost)]).toHaveLength(2);
  expect(components.missionRecords(sim.world)[0]?.evaluated).toBe(true);
  const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content, map, missions });
  expect(restored.hashState()).toBe(sim.hashState());
  expect([...restored.world.query(components.Signpost)]).toHaveLength(2);
});

it('counts invalid owners and off-map guide positions as skipped placements', () => {
  const { placements, skipped } = resolveAuthoredPlacements(
    {
      ...entities,
      guides: [...entities.guides, { player: -1, ...POINT }, { player: PLAYER, hx: -1, hy: POINT.hy }],
    },
    AUTHORED_ROWS,
    authoredMap(),
  );
  expect(placements).toHaveLength(2);
  expect(skipped).toBe(2);
});
