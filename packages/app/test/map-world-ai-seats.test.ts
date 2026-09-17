import type { TerrainMapFile } from '@open-northland/data';
import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { buildMapWorld } from '../src/entries/map/world.js';

const map: TerrainMapFile = { width: 8, height: 8, typeIds: new Array<number>(64).fill(0) };

it('seats the strategic AI as the map’s [AIData] toggles say', () => {
  const { sim } = buildMapWorld({
    seed: 3,
    map,
    ir: null,
    content: {},
    aiSeats: [1, 2, 3, 4],
    assistantSeats: [],
    fog: null,
    progression: null,
    needs: null,
    script: {
      ai: [
        { player: 2, disabled: false, strategicOff: [...components.AI_MODULE_IDS] },
        { player: 3, disabled: true, strategicOff: [] },
        { player: 4, disabled: false, strategicOff: ['military'] },
      ],
    },
  });
  sim.step();
  const { world } = sim;
  // No row: the full strategic player.
  expect(components.aiModuleRuns(world, 1, 'military')).toBe(true);
  // HAI_Disable: still a computer seat, running no strategic module.
  expect(components.isAiPlayer(world, 2)).toBe(true);
  expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(world, 2, id))).toBe(false);
  // AI_Disable: still a computer seat (the needs rules read that), running neither handler.
  expect(components.isAiPlayer(world, 3)).toBe(true);
  expect(components.aiScriptedHandlerRuns(world, 3)).toBe(false);
  expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(world, 3, id))).toBe(false);
  expect(components.aiScriptedHandlerRuns(world, 2)).toBe(true);
  // One module off, the rest on.
  expect(components.aiModuleRuns(world, 4, 'military')).toBe(false);
  expect(components.aiModuleRuns(world, 4, 'houseBuild')).toBe(true);
});
