import { type TerrainMapFile, WERESNAKE_TRIBE, WEREWOLF_TRIBE } from '@open-northland/data';
import { components, type World } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { buildMapWorld } from '../src/entries/map/world.js';

const map: TerrainMapFile = { width: 8, height: 8, typeIds: new Array<number>(64).fill(0) };

/** Whether the seat's scripted handler is on. */
function scripted(world: World, player: number): boolean {
  const carrier = components.aiPlayerEntity(world, player);
  return carrier !== null && world.get(carrier, components.AiPlayer).scripted;
}

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
        {
          player: 2,
          disabled: false,
          strategicOff: [...components.AI_MODULE_IDS],
          conditions: [],
          tasks: [],
        },
        { player: 3, disabled: true, strategicOff: [], conditions: [], tasks: [] },
        { player: 4, disabled: false, strategicOff: ['military'], conditions: [], tasks: [] },
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
  expect(scripted(world, 3)).toBe(false);
  expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(world, 3, id))).toBe(false);
  expect(scripted(world, 2)).toBe(true);
  // One module off, the rest on.
  expect(components.aiModuleRuns(world, 4, 'military')).toBe(false);
  expect(components.aiModuleRuns(world, 4, 'houseBuild')).toBe(true);
});

it('gives a monster tribe’s computer seat the scripted handler alone', () => {
  // `an original routine`: a `PLAYER_TYPE_AI` seat always gets the scripted handler, and the strategic
  // one only when its tribe is neither weresnake nor werewolf, whatever `[AIData]` says.
  const { sim } = buildMapWorld({
    seed: 3,
    map,
    ir: null,
    content: {},
    aiSeats: [1, 2],
    assistantSeats: [],
    fog: null,
    progression: null,
    needs: null,
    playerRoster: [
      { player: 1, type: 'ai', tribeId: WERESNAKE_TRIBE, colorId: 1 },
      { player: 2, type: 'ai', tribeId: WEREWOLF_TRIBE, colorId: 2 },
    ],
    script: { ai: [{ player: 1, disabled: false, strategicOff: [], conditions: [], tasks: [] }] },
  });
  sim.step();
  const { world } = sim;
  for (const seat of [1, 2]) {
    expect(scripted(world, seat)).toBe(true);
    expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(world, seat, id))).toBe(false);
  }
});
