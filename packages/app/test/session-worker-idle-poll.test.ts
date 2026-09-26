import type { SessionDriver } from '@open-northland/lockstep';
import { MS_PER_TICK } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { IDLE_POLL_TICKS, ServedSession } from '../src/session/worker/serve.js';
import { DURABLE_EVENT_KINDS } from '../src/view/runtime/world-events.js';

/** Slow, so the poll period dwarfs a timer's jitter. */
const SPEED = 0.25;
const POLL_MS = (IDLE_POLL_TICKS * MS_PER_TICK) / SPEED;
const WATCH_POLLS = 3;
/** The advances a watch may add past its polls: the first ones before the session knows it waits. */
const SETTLING_ADVANCES = 3;
const WAKE_WITHIN_MS = POLL_MS / 8;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A driver that holds no frame, as a relay client does while the relay sends none, counting its
 *  advances. */
function waitingDriver() {
  const advances: number[] = [];
  const driver: SessionDriver = {
    paused: false,
    speed: SPEED,
    droppedTicks: 0,
    maxStepsPerFrame: 5,
    setPaused: () => undefined,
    setSpeed: () => undefined,
    advance: () => {
      advances.push(performance.now());
      // A refused tick holds the owed time, which clamps the fraction at a whole tick.
      return 1;
    },
    submit: () => undefined,
    captureSave: () => {
      throw new Error('no save');
    },
  };
  return { driver, advances };
}

function servedWaiting() {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  const { driver, advances } = waitingDriver();
  const served = new ServedSession(
    () => undefined,
    { sim: createSceneSim(scene), driver, extras: null, awaitsFrames: true },
    {
      speed: SPEED,
      paused: false,
      fogSeat: null,
      diagnostics: false,
      pauseOnSubMission: false,
      undelivered: 'shed',
      retainedEventKinds: DURABLE_EVENT_KINDS,
    },
    0,
  );
  served.receive({ kind: 'start' });
  return { served, advances };
}

it('polls a driver that waits for frames at its idle period instead of spinning', async () => {
  const { served, advances } = servedWaiting();
  try {
    await sleep(WATCH_POLLS * POLL_MS);
    expect(advances.length).toBeLessThanOrEqual(WATCH_POLLS + SETTLING_ADVANCES);
  } finally {
    served.replace();
  }
});

it('asks the waiting driver again at once when woken', async () => {
  const { served, advances } = servedWaiting();
  try {
    await sleep(POLL_MS);
    const before = advances.length;
    const wokenMs = performance.now();
    served.wake();
    await sleep(WAKE_WITHIN_MS);
    const next = advances[before];
    expect(next).toBeDefined();
    expect((next ?? Number.POSITIVE_INFINITY) - wokenMs).toBeLessThan(WAKE_WITHIN_MS);
  } finally {
    served.replace();
  }
});
