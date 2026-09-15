import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import {
  components,
  parseCommandEnvelope,
  parseSaveGame,
  playerCommand,
  serializeSaveGame,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim, getScene, restoreSceneSim } from '../src/scenes/index.js';
import { TIMBER_TRIBUTE } from '../src/scenes/tribute.js';

const TICKS = 108;
const PAYMENT_TICK = 40;

describe('scripted worlds over lockstep', () => {
  it.each([
    'tribute',
    'terrain-edits',
    'presentation',
    'school',
  ])('keeps %s mutations and restore deterministic', (id) => {
    const scene = getScene(id);
    if (scene === undefined) throw new Error(`Missing scene ${id}`);
    const first = createSceneSim(scene);
    const second = createSceneSim(scene);
    first.setSyncDigest(true);
    second.setSyncDigest(true);
    const drivers = [first, second].map(
      (sim) => new LockstepDriver({ sim, transport: new LoopbackTransport() }),
    );
    for (let tick = 0; tick < TICKS; tick++) {
      if (id === 'tribute' && tick === PAYMENT_TICK) {
        const envelope = playerCommand(0, { kind: 'payTribute', player: 0, slot: TIMBER_TRIBUTE });
        for (const driver of drivers)
          driver.submit(parseCommandEnvelope(JSON.parse(JSON.stringify(envelope))));
      }
      for (const driver of drivers) expect(driver.runTick()).toBe(true);
      expect(first.syncDigest()).toEqual(second.syncDigest());
    }
    expect(first.hashState()).toBe(second.hashState());
    if (id === 'tribute') expect(first.diplomacyStance(0, 1)).toBe('friend');
    const driver = drivers[0];
    if (driver === undefined) throw new Error('Missing driver');
    const save = parseSaveGame(JSON.parse(serializeSaveGame(driver.captureSave())));
    const restored = restoreSceneSim(scene, save);
    expect(restored.hashState()).toBe(first.hashState());
    first.run(TICKS);
    restored.run(TICKS);
    expect(restored.hashState()).toBe(first.hashState());
  });

  it('retains a paid-tribute command accepted before saving and refuses another seat as payer', () => {
    const scene = getScene('tribute');
    if (scene === undefined) throw new Error('Missing tribute scene');
    const sim = createSceneSim(scene);
    sim.run(PAYMENT_TICK);
    const driver = new LockstepDriver({ sim, transport: new LoopbackTransport() });
    driver.submit(
      parseCommandEnvelope({
        v: 1,
        origin: 'player',
        player: 1,
        command: { kind: 'payTribute', player: 0, slot: TIMBER_TRIBUTE },
      }),
    );
    driver.runTick();
    expect(sim.openTributes(0).some((row) => row.slot === TIMBER_TRIBUTE)).toBe(true);
    driver.submit(playerCommand(0, { kind: 'payTribute', player: 0, slot: TIMBER_TRIBUTE }));
    const save = parseSaveGame(JSON.parse(serializeSaveGame(driver.captureSave())));
    const restored = restoreSceneSim(scene, save);
    const resumed = new LockstepDriver({ sim: restored, transport: new LoopbackTransport() });
    for (let tick = 0; tick < TICKS; tick++) {
      driver.runTick();
      resumed.runTick();
    }
    expect(restored.hashState()).toBe(sim.hashState());
    expect(restored.diplomacyStance(0, 1)).toBe('friend');
  });

  it('includes scripted verdicts in the shared match completion', () => {
    const scene = getScene('tribute');
    if (scene === undefined) throw new Error('Missing tribute scene');
    const sim = createSceneSim(scene);
    components.setMatchParticipants(sim.world, [0, 1], 'script');
    components.markScriptVerdict(sim.world, 0, 'won');
    expect(sim.matchEnded()).toBe(false);
    components.markScriptVerdict(sim.world, 1, 'lost');
    expect(sim.matchEnded()).toBe(true);
  });
});
