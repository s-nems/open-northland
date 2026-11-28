import { machineSeatsOf, type ReplayDriver } from '@open-northland/lockstep';
import { exportSaveGame, type Simulation, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { benchSession } from '../../bench/map-world.js';
import { CLIENT_BUILD, GAME_VERSION } from '../../src/build-version.js';
import { contentLobbyFingerprint } from '../../src/content/lobby-identity.js';
import {
  buildMapWorkerWorld,
  type MapWorkerBoot,
  type MapWorldInputs,
} from '../../src/entries/map/world-inputs.js';
import type { WorkerSessionOptions } from '../../src/session/worker/protocol.js';
import { replayDocumentTextOf } from '../../src/view/runtime/save-load/replay.js';
import { hasRealIr } from './helpers.js';
import { realMapWorldInputs } from './real-map-world.js';

/**
 * A real map with AI seats records through the entry's own worker world builder and plays back to the
 * state hash its recording took: nothing proves playback like a served session that must reproduce
 * one. The same recording, taken from a loaded save, must meet its hash too — a restore changes where
 * the log starts, which is the case the plain world cannot answer.
 */

const SEARCH = new URLSearchParams('?map=magiczny_las&player=observer&computer=0,1,2&seed=7');
/** The recording's first run, and the loaded save's continuation. */
const FIRST_TICKS = 40;
const NEXT_TICKS = 20;

/** The session options a playback or a recording boots under: an observer's fog, no diag cadence. */
function sessionOptions(): WorkerSessionOptions {
  return { speed: 1, paused: false, fogSeat: null, diagnostics: false, pauseOnSubMission: false };
}

function bootOf(inputs: MapWorldInputs, saveText: string | null, replayText: string | null): MapWorkerBoot {
  return {
    map: inputs.map,
    ir: inputs.ir,
    script: inputs.script,
    content: inputs.content,
    session: inputs.session,
    missions: inputs.missions,
    saveText,
    replayText,
  };
}

function replayTextOf(
  inputs: MapWorldInputs,
  sim: Simulation,
  stamps: {
    readonly startedAt: number;
    readonly savedAt: number;
    readonly initialSaveText: string | null;
    readonly fromTick: number;
  },
): string {
  if (inputs.content === null) throw new Error('the real map loaded no content to stamp');
  return replayDocumentTextOf({
    savedAt: stamps.savedAt,
    startedAt: stamps.startedAt,
    irVersion: inputs.content.manifest.version,
    identity: {
      clientBuild: CLIENT_BUILD,
      gameVersion: GAME_VERSION,
      contentFingerprint: contentLobbyFingerprint(inputs.content),
    },
    mapFingerprint: sim.mapFingerprint ?? null,
    stateHash: sim.hashState(),
    descriptor: inputs.session,
    fromTick: stamps.fromTick,
    untilTick: sim.tick,
    initialSaveText: stamps.initialSaveText,
    logText: sim.commands.logText(),
  });
}

/** Run the next `ticks` ticks through the world's off-clock step, as the served session would. */
function runTicks(world: ReturnType<typeof buildMapWorkerWorld>, ticks: number): void {
  const step = world.run?.step;
  if (step === undefined) throw new Error('the loopback world keeps no off-clock run');
  for (let i = 0; i < ticks; i++) step();
}

/** Play the recording back through the entry's own replay build, tick by tick, and return its sim. */
function playBack(inputs: MapWorldInputs, saveText: string | null, replayText: string): Simulation {
  const playback = buildMapWorkerWorld(bootOf(inputs, saveText, replayText), sessionOptions());
  const driver = playback.driver as ReplayDriver;
  for (let guard = 0; !driver.ended && guard < 10_000; guard++) driver.runTick();
  if (!driver.ended) throw new Error('the playback never reached its recording end');
  return playback.sim;
}

describe.skipIf(!hasRealIr())('a real map records and plays back through the worker world builder', () => {
  it('reproduces the recorded state hash of a world with AI seats', async () => {
    const session = benchSession(SEARCH);
    expect(machineSeatsOf(session.game).length).toBeGreaterThan(0);
    const inputs = await realMapWorldInputs(session.search);
    const recording = buildMapWorkerWorld(bootOf(inputs, null, null), sessionOptions());
    runTicks(recording, FIRST_TICKS);
    const replayText = replayTextOf(inputs, recording.sim, {
      startedAt: 1764239000000,
      savedAt: 1764240000000,
      initialSaveText: null,
      fromTick: 0,
    });
    const played = playBack(await realMapWorldInputs(session.search), null, replayText);
    expect(played.tick).toBe(recording.sim.tick);
    expect(played.hashState()).toBe(recording.sim.hashState());
  });

  it('reproduces the hash a recording taken from a loaded save took', async () => {
    const session = benchSession(SEARCH);
    // The earlier session runs, a save carries its world on, and the save's own session records
    // what it applies from there.
    const first = buildMapWorkerWorld(
      bootOf(await realMapWorldInputs(session.search), null, null),
      sessionOptions(),
    );
    runTicks(first, FIRST_TICKS);
    const saveText = serializeSaveGame(exportSaveGame(first.sim, { mapId: session.mapId }));

    const continued = buildMapWorkerWorld(
      bootOf(await realMapWorldInputs(session.search), saveText, null),
      sessionOptions(),
    );
    const restoredTick = continued.sim.tick;
    expect(restoredTick).toBeGreaterThan(0);
    runTicks(continued, NEXT_TICKS);
    const replayText = replayTextOf(await realMapWorldInputs(session.search), continued.sim, {
      startedAt: 1764239500000,
      savedAt: 1764240000000,
      initialSaveText: saveText,
      fromTick: restoredTick,
    });

    const played = playBack(await realMapWorldInputs(session.search), saveText, replayText);
    expect(played.tick).toBe(continued.sim.tick);
    expect(played.hashState()).toBe(continued.sim.hashState());
  });
});
