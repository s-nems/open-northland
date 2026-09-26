import { existsSync, readFileSync } from 'node:fs';
import { mapLobbySlots } from '@open-northland/data';
import { LOOPBACK_DELAY_TICKS, LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import { adminCommand, exportSaveGame, serializeSaveGame } from '@open-northland/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import {
  buildMapWorldFromInputs,
  type MapWorkerBoot,
  type MapWorldInputs,
} from '../../src/entries/map/world-inputs.js';
import { mapSession } from '../../src/game/session-url.js';
import {
  bundleTestWorker,
  pumpUntil,
  pumpWhile,
  startTestSession,
} from '../support/session-worker/start-worker.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';
import { realMapPath, realMapScript } from './real-map-world.js';

/**
 * The worker host on the map a session is played on: six AI seats push their own commands through the
 * queue beside the runtime's, and the worker's world matches the inline one built from the same inputs.
 */

const MAP_ID = 'magiczny_las';
const SEARCH = `map=${MAP_ID}&player=observer&ai=0,1,2,3,4,5&fog=classic`;
const RUN_TICKS = 200;
const FAST_SPEED = 16;
/** Frames between the runtime's orders, so they land beside the AI seats' own commands. */
const ORDER_EVERY_FRAMES = 5;
const ORDERS = 6;
const SAVE_AT_TICKS = 150;
const AFTER_RESTORE_TICKS = 30;
const MAP_TIMEOUT_MS = 240_000;

async function mapInputs(): Promise<MapWorldInputs> {
  const script = realMapScript(MAP_ID);
  const { merge } = await loadContentUnderTest();
  return {
    map: JSON.parse(readFileSync(realMapPath(MAP_ID), 'utf8')),
    ir: rawIrUnderTest() as ContentIr,
    script,
    goodNames: new Map(),
    content: merge.content,
    session: mapSession(new URLSearchParams(SEARCH), script === null ? [] : mapLobbySlots(script)),
    missions: null,
    save: null,
  };
}

/** The boot the map entry posts: the inputs with the staged save as its text. */
function workerBoot({ save: _parsed, ...inputs }: MapWorldInputs, saveText: string | null): MapWorkerBoot {
  return { ...inputs, saveText };
}

describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('session worker host on a decoded map', () => {
  let bundle: Awaited<ReturnType<typeof bundleTestWorker>>;
  let inputs: MapWorldInputs;
  beforeAll(async () => {
    [bundle, inputs] = await Promise.all([bundleTestWorker(), mapInputs()]);
  }, MAP_TIMEOUT_MS);
  afterAll(() => bundle.dispose());

  it("reaches the inline driver's state and log under the runtime orders and the AI seats", {
    timeout: MAP_TIMEOUT_MS,
  }, async () => {
    const session = await startTestSession(
      bundle.path,
      { kind: 'map', boot: workerBoot(inputs, null) },
      { speed: FAST_SPEED, paused: false },
    );
    try {
      const start = session.host.tick;
      let frames = 0;
      let submitted = 0;
      await pumpUntil(session, () => {
        if (++frames % ORDER_EVERY_FRAMES === 0 && submitted < ORDERS) {
          session.driver.submit(adminCommand({ kind: 'setNeedsEnabled', enabled: ++submitted % 2 === 0 }));
        }
        return session.host.tick >= start + RUN_TICKS;
      });
      session.driver.setPaused(true);
      await pumpWhile(session, session.host.settled());
      const hashed = await session.host.hashState();
      const log = await session.host.commandLog();
      const orders = log.filter((entry) => entry.origin === 'admin');
      expect(orders).toHaveLength(ORDERS);

      // The inline driver fed the same orders at the ticks the worker admitted them.
      const sim = buildMapWorldFromInputs(inputs).sim;
      const driver = new LockstepDriver({ sim, transport: new LoopbackTransport() });
      for (const order of orders) {
        while (sim.tick < order.applyTick - LOOPBACK_DELAY_TICKS) driver.runTick();
        driver.submit(adminCommand(order.command));
      }
      while (sim.tick < hashed.tick) driver.runTick();
      expect(sim.hashState()).toBe(hashed.hash);
      const logged = (entries: typeof log) =>
        entries.map((e) => [e.applyTick, e.sequence, e.origin, e.command]);
      expect(logged(sim.commands.log)).toEqual(logged(log));
    } finally {
      session.dispose();
    }
  });

  it('restores a save through the worker to the inline restore of it', {
    timeout: MAP_TIMEOUT_MS,
  }, async () => {
    const source = buildMapWorldFromInputs(inputs).sim;
    source.run(SAVE_AT_TICKS);
    const save = exportSaveGame(source, { mapId: MAP_ID });
    const restored = { ...inputs, save };
    const session = await startTestSession(bundle.path, {
      kind: 'map',
      boot: workerBoot(inputs, serializeSaveGame(save)),
    });
    try {
      const inline = buildMapWorldFromInputs(restored).sim;
      expect(await session.host.hashState()).toEqual({ tick: inline.tick, hash: inline.hashState() });
      await pumpWhile(session, session.host.run(AFTER_RESTORE_TICKS));
      inline.run(AFTER_RESTORE_TICKS);
      expect(await session.host.hashState()).toEqual({ tick: inline.tick, hash: inline.hashState() });
    } finally {
      session.dispose();
    }
  });
});
