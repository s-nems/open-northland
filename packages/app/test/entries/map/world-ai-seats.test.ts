import {
  MapScript,
  mapLobbySlots,
  type TerrainMapFile,
  WERESNAKE_TRIBE,
  WEREWOLF_TRIBE,
} from '@open-northland/data';
import { applyInitialSaveSeats } from '@open-northland/lockstep';
import { components, exportSaveGame, type World } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { buildMapWorld } from '../../../src/entries/map/world.js';
import { buildRelayedMapWorld } from '../../../src/entries/map/world-inputs.js';
import { mapSession, sessionSearch } from '../../../src/game/match/session-url.js';
import { sessionWorldOptions } from '../../../src/game/match/session-world.js';
import { mapScriptWorld } from '../../../src/game/world/mission-script.js';

const map: TerrainMapFile = { width: 8, height: 8, typeIds: new Array<number>(64).fill(0) };

/** Whether the seat's map AI controller is on. */
function mapAiRuns(world: World, player: number): boolean {
  const carrier = components.aiControlEntity(world, player);
  return carrier !== null && world.get(carrier, components.AiControl).mapAiEnabled;
}

it('seats the computer player as the map’s [AIData] toggles say', () => {
  const { sim } = buildMapWorld({
    seed: 3,
    map,
    ir: null,
    content: {},
    machineSeats: [1, 2, 3, 4],
    assistantSeats: [],
    fog: null,
    progression: null,
    needs: null,
    alliedVision: null,
    peace: null,
    script: {
      ai: [
        {
          player: 2,
          allDisabled: false,
          computerDisabled: true,
          disabledComputerModules: [],
          conditions: [],
          tasks: [],
        },
        {
          player: 3,
          allDisabled: true,
          computerDisabled: false,
          disabledComputerModules: [],
          conditions: [],
          tasks: [],
        },
        {
          player: 4,
          allDisabled: false,
          computerDisabled: false,
          disabledComputerModules: ['military'],
          conditions: [],
          tasks: [],
        },
      ],
    },
  });
  sim.step();
  const { world } = sim;
  // No row: the autonomous computer player.
  expect(components.computerModuleRuns(world, 1, 'military')).toBe(true);
  // HAI_Disable: still a machine seat, running no computer module.
  expect(components.isMachinePlayer(world, 2)).toBe(true);
  expect(components.COMPUTER_MODULE_IDS.some((id) => components.computerModuleRuns(world, 2, id))).toBe(
    false,
  );
  // AI_Disable: still a machine seat (the needs rules read that), running neither handler.
  expect(components.isMachinePlayer(world, 3)).toBe(true);
  expect(mapAiRuns(world, 3)).toBe(false);
  expect(components.COMPUTER_MODULE_IDS.some((id) => components.computerModuleRuns(world, 3, id))).toBe(
    false,
  );
  expect(mapAiRuns(world, 2)).toBe(true);
  // One module off, the rest on.
  expect(components.computerModuleRuns(world, 4, 'military')).toBe(false);
  expect(components.computerModuleRuns(world, 4, 'houseBuild')).toBe(true);
});

it('gives a monster tribe’s machine seat the map AI controller alone', () => {
  // Original behavior: a `PLAYER_TYPE_AI` seat always gets the map AI controller, and the strategic
  // one only when its tribe is neither weresnake nor werewolf, whatever `[AIData]` says.
  const { sim } = buildMapWorld({
    seed: 3,
    map,
    ir: null,
    content: {},
    machineSeats: [1, 2],
    assistantSeats: [],
    fog: null,
    progression: null,
    needs: null,
    alliedVision: null,
    peace: null,
    playerRoster: [
      { player: 1, type: 'ai', tribeId: WERESNAKE_TRIBE, colorId: 1 },
      { player: 2, type: 'ai', tribeId: WEREWOLF_TRIBE, colorId: 2 },
    ],
    script: {
      ai: [
        {
          player: 1,
          allDisabled: false,
          computerDisabled: false,
          disabledComputerModules: [],
          conditions: [],
          tasks: [],
        },
      ],
    },
  });
  sim.step();
  const { world } = sim;
  for (const seat of [1, 2]) {
    expect(mapAiRuns(world, seat)).toBe(true);
    expect(components.COMPUTER_MODULE_IDS.some((id) => components.computerModuleRuns(world, seat, id))).toBe(
      false,
    );
  }
});

it('starts the assistant switches for the seats a person or the computer player plays, never a scripted camp', () => {
  // A seat running no computer module is the map's scripted camp.
  const PERSON = 0;
  const COMPUTER = 1;
  const SCRIPTED_CAMP = 2;
  const DISABLED = 3;
  const { sim } = buildMapWorld({
    seed: 3,
    map,
    ir: null,
    content: {},
    machineSeats: [COMPUTER, SCRIPTED_CAMP, DISABLED],
    assistantSeats: [PERSON, COMPUTER, SCRIPTED_CAMP, DISABLED],
    fog: null,
    progression: null,
    needs: null,
    alliedVision: null,
    peace: null,
    script: {
      ai: [
        {
          player: SCRIPTED_CAMP,
          allDisabled: false,
          computerDisabled: true,
          disabledComputerModules: [],
          conditions: [],
          tasks: [],
        },
        {
          player: DISABLED,
          allDisabled: true,
          computerDisabled: false,
          disabledComputerModules: [],
          conditions: [],
          tasks: [],
        },
      ],
    },
  });
  sim.step();
  const started = [PERSON, COMPUTER, SCRIPTED_CAMP, DISABLED].filter((seat) =>
    sim.assistantUpgradesTools(seat),
  );
  expect(started).toEqual([PERSON, COMPUTER]);
});

it('round-trips Map AI, Computer and Idle into distinct world control', () => {
  const script = MapScript.parse({
    players: [0, 1, 2, 3].map((player) => ({ player, type: 'ai', tribeId: 1, colorId: player })),
    multiplayer: {
      slotOptions: [0, 1, 2, 3].map((player) => ({
        player,
        allowed: player === 0 || player === 2 ? ['ai'] : ['human', 'ai'],
      })),
    },
    ai: [
      {
        player: 0,
        allDisabled: false,
        computerDisabled: false,
        disabledComputerModules: ['military'],
        conditions: [],
        tasks: [],
      },
      {
        player: 1,
        allDisabled: true,
        computerDisabled: false,
        disabledComputerModules: [],
        conditions: [],
        tasks: [],
      },
      {
        player: 2,
        allDisabled: true,
        computerDisabled: false,
        disabledComputerModules: [],
        conditions: [],
        tasks: [],
      },
    ],
  });
  const roster = mapLobbySlots(script);
  const session = mapSession(
    new URLSearchParams('map=synthetic&player=observer&computer=1&idle=3&seed=7'),
    roster,
  );
  expect(session.seats.map((seat) => seat.mode)).toEqual(['map-ai', 'computer', 'map-ai', 'idle']);
  expect(mapSession(sessionSearch(session, roster), roster)).toEqual(session);
  const world = mapScriptWorld(script, null);
  const { sim } = buildMapWorld({
    seed: 7,
    map,
    ir: null,
    content: {},
    playerRoster: script.players,
    script: world,
    ...sessionWorldOptions(session, script, world),
  });
  expect(components.computerModuleRuns(sim.world, 0, 'military')).toBe(false);
  expect(components.computerModuleRuns(sim.world, 0, 'houseBuild')).toBe(true);
  expect(components.COMPUTER_MODULE_IDS.every((id) => components.computerModuleRuns(sim.world, 1, id))).toBe(
    true,
  );
  expect(mapAiRuns(sim.world, 1)).toBe(true);
  expect(components.COMPUTER_MODULE_IDS.some((id) => components.computerModuleRuns(sim.world, 2, id))).toBe(
    false,
  );
  expect(mapAiRuns(sim.world, 2)).toBe(false);
  expect(components.isMachinePlayer(sim.world, 3)).toBe(false);
});

it('resumes valid Computer and Idle transitions and preserves unchanged controller switches', () => {
  const script = MapScript.parse({
    players: [0, 1, 2, 3, 4].map((player) => ({
      player,
      type: 'ai',
      tribeId: 1,
      colorId: player,
    })),
    multiplayer: {
      slotOptions: [0, 1, 2, 3, 4].map((player) => ({
        player,
        allowed: player === 2 ? ['ai'] : ['human', 'ai'],
      })),
    },
    ai: [0, 1, 2, 3, 4].map((player) => ({
      player,
      allDisabled: true,
      computerDisabled: false,
      disabledComputerModules: [],
      conditions: [],
      tasks: [],
    })),
  });
  const roster = mapLobbySlots(script);
  // Seats 0 and 3 wake from Idle, seat 1 becomes Idle; reserved 2 and Computer 4 keep their modes.
  const previous = mapSession(
    new URLSearchParams('map=test&seed=3&player=observer&computer=1,4&idle=0,3'),
    roster,
  );
  expect(previous.seats.map((seat) => seat.mode)).toEqual(['idle', 'computer', 'map-ai', 'idle', 'computer']);
  const boot = { map, ir: null, script, content: null, session: previous, missions: null, saveText: null };
  const original = buildRelayedMapWorld(boot, null).sim;
  original.step();
  original.enqueueSetup({ kind: 'setAiControl', player: 2, enabled: true });
  original.enqueueSetup({
    kind: 'setAiControl',
    player: 4,
    enabled: true,
    computerEnabled: false,
    mapAiEnabled: false,
  });
  original.step();
  const save = exportSaveGame(original, { mapId: 'test', entry: `?${sessionSearch(previous, roster)}` });
  const next = {
    ...mapSession(new URLSearchParams('map=test&seed=3&player=observer&computer=0,3,4&idle=1'), roster),
    initialSave: { tick: save.header.tick, fingerprint: 'a'.repeat(64) },
  };
  expect(next.seats.map((seat) => seat.mode)).toEqual(['computer', 'idle', 'map-ai', 'computer', 'computer']);
  const restored = buildRelayedMapWorld({ ...boot, session: next }, save);
  applyInitialSaveSeats(restored.sim, next, restored.initialSeatSetups);
  restored.sim.step();
  for (const player of [0, 3]) {
    expect(components.computerModuleRuns(restored.sim.world, player, 'military')).toBe(true);
    expect(mapAiRuns(restored.sim.world, player)).toBe(true);
  }
  expect(components.isMachinePlayer(restored.sim.world, 1)).toBe(false);
  // The saved map AI override survives its authored AI_Disable flag.
  expect(components.computerModuleRuns(restored.sim.world, 2, 'military')).toBe(true);
  expect(mapAiRuns(restored.sim.world, 2)).toBe(true);
  // Keeping Computer mode must not re-enable controllers disabled during play.
  expect(components.isMachinePlayer(restored.sim.world, 4)).toBe(true);
  expect(components.computerModuleRuns(restored.sim.world, 4, 'military')).toBe(false);
  expect(mapAiRuns(restored.sim.world, 4)).toBe(false);
});
