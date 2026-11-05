import type { GameSession } from '@open-northland/lockstep';
import { JITTER_BUFFER_TICKS, RelayClient } from '@open-northland/net-client';
import { TICK_MS } from '@open-northland/net-protocol';
import { Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';

const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 3,
  seats: [{ player: 0, mode: 'human', color: 0 }],
  localSeat: 0,
  rules: {
    fog: null,
    progression: null,
    needs: null,
    weather: null,
    dayNight: null,
    alliedVision: null,
    peace: null,
  },
  speed: 1,
};
const DISPLAY_FRAME_MS = 1000 / 60;
const DISPLAY_FRAMES_PER_TICK = Math.round(TICK_MS / DISPLAY_FRAME_MS);
const SETTLE_MS = 3000;
const HOLD_MS = 2000;
const AFTER_HOLD_MS = 4000;
/** Display frames after a hold that may still find the buffer empty while the pacer refills it. */
const REFILL_FRAMES = DISPLAY_FRAMES_PER_TICK * JITTER_BUFFER_TICKS * 2;

async function runningClient(): Promise<RelayClient> {
  const sim = new Simulation({ seed: SESSION.seed, content: testContent() });
  const client = new RelayClient({
    token: 'relay-pacing-0123456789',
    nick: 'Ania',
    now: () => 0,
    world: { open: async () => ({ sim, generation: 0 }), restore: async () => null },
  });
  client.attach(() => undefined);
  client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
  await client.settled();
  return client;
}

it('refills the jitter buffer after a relay hold instead of running each frame the moment it lands', async () => {
  const client = await runningClient();
  let now = 0;
  let nextFrameAt = 0;
  let tick = 0;
  const run = (ms: number, emitting: boolean, trace?: number[]) => {
    const end = now + ms;
    while (now < end) {
      now += DISPLAY_FRAME_MS;
      if (!emitting) nextFrameAt = now;
      while (emitting && nextFrameAt <= now) {
        tick++;
        client.receive({ kind: 'frame', tick, commands: [] });
        nextFrameAt += TICK_MS;
      }
      client.advance(DISPLAY_FRAME_MS);
      trace?.push(client.bufferedTicks);
    }
  };
  run(SETTLE_MS, true);
  run(HOLD_MS, false);
  const after: number[] = [];
  run(AFTER_HOLD_MS, true, after);
  expect(after.filter((buffered) => buffered === 0).length).toBeLessThanOrEqual(REFILL_FRAMES);
});

it('runs a burst of late frames one tick per display frame rather than five at once', async () => {
  const client = await runningClient();
  let tick = 0;
  const perAdvance: number[] = [];
  const frame = (deliver: number) => {
    for (let i = 0; i < deliver; i++) {
      tick++;
      client.receive({ kind: 'frame', tick, commands: [] });
    }
    let ran = 0;
    client.advance(DISPLAY_FRAME_MS, () => ran++);
    perAdvance.push(ran);
  };
  const steady = (frames: number) => {
    for (let i = 0; i < frames; i++) frame(i % DISPLAY_FRAMES_PER_TICK === 0 ? 1 : 0);
  };
  const stallFrames = 60;
  const burstTicks = 12;
  steady(300);
  for (let i = 0; i < stallFrames; i++) frame(0);
  perAdvance.length = 0;
  frame(burstTicks);
  steady(120);
  expect(Math.max(...perAdvance)).toBe(1);
});

it('absorbs tick-sized link jitter with small tempo corrections and a bounded reserve', async () => {
  const client = await runningClient();
  // A 420 ms round trip with ordered delivery despite +/-80 ms of downstream jitter.
  const offsets = [-80, 60, -40, 80, 0, -60, 40];
  const arrivals: number[] = [];
  for (let tick = 1; tick <= 360; tick++) {
    arrivals.push(
      Math.max(arrivals.at(-1) ?? 0, tick * TICK_MS + 210 + (offsets[(tick - 1) % offsets.length] ?? 0)),
    );
  }
  let received = 0;
  let previousPosition = 0;
  const tempos: number[] = [];
  const buffers: number[] = [];
  const applied: number[] = [];
  for (let frame = 0; frame < 1800; frame++) {
    const now = frame * DISPLAY_FRAME_MS;
    while ((arrivals[received] ?? Infinity) <= now)
      client.receive({ kind: 'frame', tick: ++received, commands: [] });
    const alpha = client.advance(DISPLAY_FRAME_MS, () => applied.push(client.tick ?? 0));
    const position = (client.tick ?? 0) + alpha;
    if (now >= 10_000) {
      tempos.push(((position - previousPosition) * TICK_MS) / DISPLAY_FRAME_MS);
      buffers.push(client.bufferedTicks);
    }
    previousPosition = position;
  }
  expect(Math.min(...tempos)).toBeGreaterThanOrEqual(0.9 - 1e-9);
  expect(Math.max(...tempos)).toBeLessThanOrEqual(1.1 + 1e-9);
  expect(Math.min(...buffers)).toBeGreaterThan(0);
  expect(Math.max(...buffers)).toBeLessThanOrEqual(JITTER_BUFFER_TICKS + 2);
  expect(client.tick).toBeGreaterThanOrEqual(353);
  expect(applied).toEqual(Array.from({ length: applied.length }, (_, index) => index + 1));
});
