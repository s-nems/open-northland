import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapLobbySlots } from '@open-northland/data';
import { LOOPBACK_DELAY_TICKS, LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import {
  components,
  type Entity,
  nodeOfPosition,
  parseSaveGame,
  playerCommand,
  SAVE_FORMAT_VERSION,
  type Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorldFromInputs, type MapWorldInputs } from '../../src/entries/map/world-inputs.js';
import { mapSession } from '../../src/game/session-url.js';
import { inlineSessionHost } from '../../src/session/index.js';
import type { WorkerSession } from '../../src/session/worker/worker-session.js';
import { bundleTestWorker, pumpWhile, startTestSession } from '../support/session-worker/start-worker.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';
import { realMapPath, realMapScript } from './real-map-world.js';

/**
 * The worker host on a late, heavy world: the six-AI magiczny_las benchmark checkpoint at tick 40000,
 * restored inline and in the worker, stepped under the same player orders, stays hash-identical.
 */

const { Owner, Position, Settler } = components;

const MAP_ID = 'magiczny_las';
/** The benchmark session the checkpoint was taken under. */
const SEARCH = `map=${MAP_ID}&player=observer&ai=0,1,2,3,4,5&fog=classic`;
// A local benchmark artefact, ignored by Git, so the test skips where it was never taken.
const CHECKPOINT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../bench-out/ml6-s51.t40000.checkpoint',
);
/** The seat whose settlers take the orders. */
const ORDERED_SEAT = 0;
/** Ticks after the restore at which one order is submitted, each walking a settler to the next one. */
const ORDER_OFFSETS = [10, 60, 150, 260] as const;
const RUN_TICKS = 400;
const CHECKPOINT_TIMEOUT_MS = 240_000;

/** A checkpoint from another save format is as absent as a missing one: this build cannot read it. */
function checkpointReadable(): boolean {
  if (!existsSync(CHECKPOINT)) return false;
  const head = JSON.parse(readFileSync(CHECKPOINT, 'utf8')) as { header?: { formatVersion?: unknown } };
  return head.header?.formatVersion === SAVE_FORMAT_VERSION;
}

async function checkpointInputs(): Promise<MapWorldInputs> {
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

/** The seat's settlers in id order, so both sides pick the same ones from the same state. */
function seatSettlers(sim: Simulation): readonly Entity[] {
  const settlers: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player === ORDERED_SEAT) settlers.push(e);
  }
  return settlers.sort((a, b) => a - b);
}

function walkOrder(sim: Simulation, settlers: readonly Entity[], index: number) {
  const walker = settlers[index];
  const target = settlers[index + 1];
  if (walker === undefined || target === undefined) {
    throw new Error(`seat ${ORDERED_SEAT} has too few settlers for order ${index}`);
  }
  const at = sim.world.get(target, Position);
  const { hx, hy } = nodeOfPosition(at.x, at.y);
  return playerCommand(ORDERED_SEAT, { kind: 'moveUnit', entity: walker, x: hx, y: hy });
}

describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))(
  'session worker host on a late checkpoint',
  () => {
    it.skipIf(!checkpointReadable())(
      "keeps the inline host's state hashes and log under player orders",
      { timeout: CHECKPOINT_TIMEOUT_MS },
      async () => {
        const saveText = readFileSync(CHECKPOINT, 'utf8');
        const [bundle, inputs] = await Promise.all([bundleTestWorker(), checkpointInputs()]);
        let session: WorkerSession<null> | null = null;
        try {
          const { save: _none, ...bootInputs } = inputs;
          const booting = startTestSession(bundle.path, { kind: 'map', boot: { ...bootInputs, saveText } });
          // Both restores run at once; the finally hands a booted worker to the disposal below.
          let sim: Simulation;
          try {
            sim = buildMapWorldFromInputs({ ...inputs, save: parseSaveGame(JSON.parse(saveText)) }).sim;
          } finally {
            session = await booting;
          }
          const worker = session;
          const inline = inlineSessionHost(sim, { snapshots: 'live' });
          const driver = new LockstepDriver({ sim, transport: new LoopbackTransport() });
          const start = sim.tick;
          const settlers = seatSettlers(sim);

          const compareHashes = async () => {
            const expected = await inline.hashState();
            expect(await worker.host.hashState()).toEqual(expected);
          };
          /** Step both sides to `offset` after the restore: the worker's run proceeds on its own thread
           *  while this one steps the inline driver. */
          const runTo = async (offset: number) => {
            const running = worker.host.run(start + offset - worker.host.tick);
            while (sim.tick < start + offset) driver.runTick();
            await pumpWhile(worker, running);
          };

          await compareHashes();
          for (const [index, offset] of ORDER_OFFSETS.entries()) {
            await runTo(offset);
            await compareHashes();
            const order = walkOrder(sim, settlers, index);
            driver.submit(order);
            worker.driver.submit(order);
          }
          await runTo(RUN_TICKS);
          await compareHashes();

          const log = await worker.host.commandLog();
          expect(log).toEqual(await inline.commandLog());
          const orders = log.filter((entry) => entry.origin === 'player');
          expect(orders.map((entry) => entry.applyTick - start)).toEqual(
            ORDER_OFFSETS.map((offset) => offset + LOOPBACK_DELAY_TICKS),
          );
        } finally {
          session?.dispose();
          await bundle.dispose();
        }
      },
    );
  },
);
