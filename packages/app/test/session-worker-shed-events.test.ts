import { MessageChannel } from 'node:worker_threads';
import type { Entity, SimEvent } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { servedOverLoopback } from '../src/session/worker/loopback.js';
import type { FromWorker, WorkerSessionOptions } from '../src/session/worker/protocol.js';
import { type HostedBuild, serveSession, undeliveredTickLimit } from '../src/session/worker/serve.js';
import { startWorkerSession } from '../src/session/worker/worker-session.js';
import { nodeParentPort } from './support/session-worker/node-ports.js';

const SHED_SPEED = 16;
const TURN_MS = 20;
const PAST_THE_LIMIT_TIMEOUT_MS = 30_000;
/** A node no scene reaches, so the stamped events are told apart from the sandbox's own. */
const STAMP_NODE = { hx: -1, hy: -1 };
const SILENT_STALL_REPORTS = { stalled: () => undefined, recovered: () => undefined };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The sandbox with every tick stamped by a durable `buildingPlaced` and a transient `buildingFinished`
 *  naming the tick. */
function stampedSandbox(_boot: null, options: WorkerSessionOptions): HostedBuild<null> {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  const sim = createSceneSim(scene);
  const step = sim.step.bind(sim);
  sim.step = (): void => {
    step();
    const stamp = sim.tick as Entity;
    sim.events.emit({ kind: 'buildingPlaced', entity: stamp, at: STAMP_NODE });
    sim.events.emit({ kind: 'buildingFinished', entity: stamp });
  };
  return servedOverLoopback({ sim, extras: null }, options);
}

function stampedTicks(events: readonly SimEvent[], kind: 'buildingPlaced' | 'buildingFinished'): number[] {
  return events.flatMap((event) =>
    event.kind === kind && (event.kind !== 'buildingPlaced' || event.at.hx === STAMP_NODE.hx)
      ? [event.entity]
      : [],
  );
}

it('delivers the retained events of shed ticks ahead of the next delivered tick, in order', async () => {
  const channel = new MessageChannel();
  serveSession(nodeParentPort(channel.port1), stampedSandbox);
  const inner = nodeParentPort(channel.port2);
  let shedTicks = 0;
  const session = await startWorkerSession<null, null>(
    {
      ...inner,
      close: () => {
        channel.port1.close();
        channel.port2.close();
      },
      listen: (receive) =>
        inner.listen((message, receiveMs) => {
          const landed = message as FromWorker<null>;
          if (landed.kind === 'ticks') shedTicks += landed.batch.shedTicks;
          receive(message, receiveMs);
        }),
    },
    null,
    {
      speed: SHED_SPEED,
      paused: false,
      fogSeat: null,
      diagnostics: false,
      pauseOnSubMission: false,
      undelivered: 'shed',
      retainedEventKinds: ['buildingPlaced'],
    },
    SILENT_STALL_REPORTS,
  );
  const seen: SimEvent[] = [];
  const onTick = () => seen.push(...session.host.tickEvents());
  try {
    const start = session.host.tick;
    session.driver.advance(0, onTick);
    const pastHold = undeliveredTickLimit(SHED_SPEED) + session.driver.maxStepsPerFrame;
    const deadline = performance.now() + PAST_THE_LIMIT_TIMEOUT_MS;
    while ((await session.host.hashState()).tick - session.host.tick <= pastHold) {
      if (performance.now() > deadline) throw new Error('the shedding worker stopped at its limit');
      await sleep(TURN_MS);
    }
    session.driver.setPaused(true);
    // Answered after the pause, so no tick follows it.
    const last = (await session.host.hashState()).tick;
    while (session.host.tick < last) {
      session.driver.advance(0, onTick);
      await sleep(TURN_MS);
    }

    expect(shedTicks).toBeGreaterThan(0);
    const every = Array.from({ length: last - start }, (_, i) => start + 1 + i);
    expect(stampedTicks(seen, 'buildingPlaced')).toEqual(every);
    expect(stampedTicks(seen, 'buildingFinished')).toHaveLength(every.length - shedTicks);
  } finally {
    session.dispose();
  }
});
