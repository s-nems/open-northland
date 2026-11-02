import {
  adminCommand,
  components,
  exportSaveGame,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { applyInitialSaveSeats, LockstepDriver, LoopbackTransport, type TickFrame } from '../src/index.js';

it('restores paused transport orders after endogenous commands without changing the continuing run', () => {
  const content = testContent();
  const sim = new Simulation({ seed: 5, content });
  const driver = new LockstepDriver({ sim, transport: new LoopbackTransport(), paused: true });
  sim.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
  driver.submit(adminCommand({ kind: 'setNeedsEnabled', enabled: true }));
  driver.submit(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
  const before = sim.hashState();
  const saved = parseSaveGame(JSON.parse(serializeSaveGame(driver.captureSave())));
  expect(sim.tick).toBe(0);
  expect(sim.hashState()).toBe(before);
  expect(sim.commands.pendingCount).toBe(1);
  const restored = restoreSimulation(saved, { content });
  const resumed = new LockstepDriver({ sim: restored, transport: new LoopbackTransport(), paused: true });
  const savedAgain = resumed.captureSave();
  expect(savedAgain).toEqual(saved);
  driver.setPaused(false);
  resumed.setPaused(false);
  for (let tick = 0; tick < 8; tick++) {
    expect(driver.runTick()).toBe(true);
    expect(resumed.runTick()).toBe(true);
    expect(restored.hashState()).toBe(sim.hashState());
    expect(restored.commands.log).toEqual(sim.commands.log);
  }
  expect(restored.commands.log.map(({ command }) => command)).toEqual([
    { kind: 'setNeedsEnabled', enabled: false },
    { kind: 'setNeedsEnabled', enabled: true },
    { kind: 'setNeedsEnabled', enabled: false },
  ]);
});

it('does not silently export a partial save from a transport without authority over future inputs', () => {
  const sim = new Simulation({ seed: 5, content: testContent() });
  const driver = new LockstepDriver({ sim, transport: { submit() {}, take: () => null } });
  expect(() => driver.captureSave()).toThrow(/authority/);
});

it('a new human seat supersedes the old room AI takeover while retaining player orders', () => {
  const content = testContent();
  const sim = new Simulation({ seed: 5, content });
  const command = playerCommand(1, {
    kind: 'setAssistantCounter',
    player: 1,
    counter: 'extraMen',
    value: 3,
    infinite: false,
  });
  const save = exportSaveGame(sim, {
    continuation: [
      { applyTick: 1, envelope: adminCommand({ kind: 'setAiControl', player: 1, enabled: true }) },
      { applyTick: 2, envelope: command },
    ],
  });
  const reconnect = restoreSimulation(save, { content });
  reconnect.step();
  expect(components.isMachinePlayer(reconnect.world, 1)).toBe(true);
  const resumed = restoreSimulation(save, { content });
  applyInitialSaveSeats(resumed, {
    initialSave: { tick: 0, fingerprint: 'a'.repeat(64) },
    world: { kind: 'scene', sceneId: 'test' },
    seed: 5,
    localSeat: 1,
    speed: 1,
    seats: [{ player: 1, mode: 'human', color: 1 }],
    rules: {
      fog: null,
      progression: null,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
    },
  });
  resumed.run(3);
  expect(components.isMachinePlayer(resumed.world, 1)).toBe(false);
  // The discarded takeover is not replaced by a no-op hand-back, so the player order is the first command.
  expect(resumed.commands.log.filter((entry) => entry.origin === 'player')).toEqual([
    { ...command, applyTick: 2, sequence: 0 },
  ]);
});

it('a resumed room keeps the saved handlers and module toggles of a seat that stays a computer player', () => {
  const content = testContent();
  const sim = new Simulation({ seed: 5, content });
  const disabledComputerModules = Object.fromEntries(components.COMPUTER_MODULE_IDS.map((id) => [id, false]));
  sim.enqueueSetup({ kind: 'setAiControl', player: 6, enabled: true, modules: disabledComputerModules });
  sim.enqueueSetup({
    kind: 'setAiControl',
    player: 7,
    enabled: true,
    modules: disabledComputerModules,
    mapAiEnabled: false,
  });
  sim.step();
  const save = exportSaveGame(sim, { continuation: [] });
  const resumed = restoreSimulation(save, { content });
  applyInitialSaveSeats(resumed, {
    initialSave: { tick: 1, fingerprint: 'a'.repeat(64) },
    world: { kind: 'scene', sceneId: 'test' },
    seed: 5,
    localSeat: 0,
    speed: 1,
    seats: [
      { player: 0, mode: 'human', color: 0 },
      { player: 6, mode: 'computer', color: 6 },
      { player: 7, mode: 'computer', color: 7 },
      { player: 8, mode: 'computer', color: 8 },
    ],
    rules: {
      fog: null,
      progression: null,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
    },
  });
  resumed.run(2);
  expect(components.computerModuleRuns(resumed.world, 6, 'military')).toBe(false);
  const disabled = components.aiControlEntity(resumed.world, 7);
  expect(disabled).not.toBeNull();
  if (disabled !== null) expect(resumed.world.get(disabled, components.AiControl).mapAiEnabled).toBe(false);
  // A seat the save ran as a person is handed to a full computer player.
  expect(components.computerModuleRuns(resumed.world, 8, 'military')).toBe(true);
  expect(components.isMachinePlayer(resumed.world, 0)).toBe(false);
});

it('captures pending commands in assigned sequence order without mutating transport frames', () => {
  const content = testContent();
  const sim = new Simulation({ seed: 5, content });
  const frame: TickFrame = {
    tick: 1,
    commands: [
      { sequence: 1, envelope: adminCommand({ kind: 'setNeedsEnabled', enabled: false }) },
      { sequence: 0, envelope: adminCommand({ kind: 'setNeedsEnabled', enabled: true }) },
    ],
  };
  const driver = new LockstepDriver({
    sim,
    transport: {
      submit() {},
      take: () => frame,
      pendingFrames: () => [frame],
    },
  });
  const restored = restoreSimulation(driver.captureSave(), { content });
  driver.runTick();
  restored.step();
  expect(sim.needsEnabled()).toBe(false);
  expect(restored.needsEnabled()).toBe(false);
  expect(restored.commands.log).toEqual(sim.commands.log);
  expect(restored.hashState()).toBe(sim.hashState());
  expect(frame.commands.map(({ sequence }) => sequence)).toEqual([1, 0]);
});

it('removes local continuation grants and queued grants before a saved multiplayer world accepts orders', () => {
  const content = testContent();
  const sim = new Simulation({ seed: 5, content });
  components.setMatchParticipants(sim.world, [0, 1, 2]);
  components.markPlayerDead(sim.world, 1);
  components.continueMatch(sim.world, 1);
  const order = (player: number) =>
    playerCommand(player, {
      kind: 'setAssistantCounter',
      player,
      counter: 'extraMen',
      value: 3,
      infinite: false,
    });
  sim.enqueue(order(1));
  sim.enqueue(adminCommand({ kind: 'continueMatch', player: 1 }));
  sim.enqueue(order(1));
  const save = exportSaveGame(sim, {
    continuation: [
      { applyTick: 2, envelope: adminCommand({ kind: 'continueMatch', player: 1 }) },
      { applyTick: 2, envelope: order(1) },
      { applyTick: 2, envelope: order(0) },
    ],
  });
  const resumed = restoreSimulation(save, { content });
  applyInitialSaveSeats(resumed, {
    initialSave: { tick: 0, fingerprint: 'a'.repeat(64) },
    world: { kind: 'scene', sceneId: 'test' },
    seed: 5,
    localSeat: 1,
    speed: 1,
    seats: [0, 1, 2].map((player) => ({ player, mode: 'human', color: player })),
    rules: {
      fog: null,
      progression: null,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
    },
  });
  resumed.run(3);
  expect(components.hasMatchContinuation(resumed.world)).toBe(false);
  expect(resumed.matchOutcome(1)).toBe('defeat');
  expect(components.assistantCountersEntity(resumed.world, 1)).toBeNull();
  const living = components.assistantCountersEntity(resumed.world, 0);
  expect(living).not.toBeNull();
  if (living !== null)
    expect(resumed.world.get(living, components.AssistantCounters).counters.extraMen.value).toBe(3);
  expect(resumed.commands.log.some((entry) => entry.command.kind === 'continueMatch')).toBe(false);
  // Preparing the shared session never changes the saved local session.
  const local = restoreSimulation(save, { content });
  local.run(3);
  expect(components.isContinuingMatch(local.world, 1)).toBe(true);
  expect(components.assistantCountersEntity(local.world, 1)).not.toBeNull();
});
