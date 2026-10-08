import type { GameSession } from '@open-northland/lockstep';
import { RelayClient } from '@open-northland/net-client';
import { type ClientMessage, type ResponsivenessMode, TICK_MS } from '@open-northland/net-protocol';
import { playerCommand, Simulation } from '@open-northland/sim';
import { expect, it, vi } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import * as pacer from '../src/pacer.js';

const STEP_MS = 5;
const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 3,
  seats: [{ player: 0, mode: 'human', color: 0 }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
const select = (client: RelayClient, bufferTicks: number): void => {
  const mode: ResponsivenessMode =
    bufferTicks === 1 ? 'responsive' : bufferTicks === 2 ? 'balanced' : 'smooth';
  client.receive({ kind: 'responsiveness', mode, bufferTicks, by: 'Ania' });
};

async function runningClient(bufferTicks: number, now: () => number, speed = 1) {
  const applied = new Map<number, number>();
  const sent: ClientMessage[] = [];
  const client = new RelayClient({
    token: 'pacing-transition-0123456789',
    nick: 'Ania',
    now,
    world: {
      open: async () => ({
        sim: new Simulation({ seed: SESSION.seed, content: testContent() }),
        generation: 0,
      }),
      restore: async () => null,
    },
  });
  client.attach((message) => {
    sent.push(message);
    if (message.kind === 'ack') applied.set(message.tick, now());
  });
  select(client, bufferTicks);
  client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
  await client.settled();
  client.receive({ kind: 'clock', tick: 1, speed, paused: false, by: null, governed: null });
  return { client, applied, sent };
}

it('finishes shrinking when several ticks arrive between display advances', async () => {
  let now = 0;
  const speed = 8;
  const stepMs = 1000 / 60;
  const { client, applied } = await runningClient(2, () => now, speed);
  let emitted = 0;
  let frameTime = 0;
  const pacing = vi.spyOn(pacer, 'paceScale');
  try {
    for (let step = 0; step < 240; step++) {
      now += stepMs;
      if (step === 60) select(client, 1);
      frameTime += stepMs * speed;
      while (frameTime >= TICK_MS) {
        frameTime -= TICK_MS;
        client.receive({ kind: 'frame', tick: ++emitted, commands: [] });
      }
      client.advance(stepMs);
    }
    expect(pacing.mock.calls.some((call) => call[3] === true)).toBe(true);
    expect(pacing.mock.calls.slice(-60).every((call) => call[3] === false)).toBe(true);
    expect([...applied.keys()]).toEqual(Array.from({ length: applied.size }, (_, i) => i + 1));
    expect(emitted - applied.size).toBeLessThanOrEqual(2);
  } finally {
    pacing.mockRestore();
  }
});

function medianDifference(
  a: ReadonlyMap<number, number>,
  b: ReadonlyMap<number, number>,
  from: number,
  to: number,
): number {
  const differences: number[] = [];
  for (let tick = from; tick <= to; tick++) {
    const first = a.get(tick);
    const second = b.get(tick);
    if (first === undefined || second === undefined)
      throw new Error(`tick ${tick} was not applied by both clients`);
    differences.push(first - second);
  }
  differences.sort((a, b) => a - b);
  return differences[Math.floor(differences.length / 2)] ?? 0;
}

it.each(['running', 'paused', 'reconnecting', 'replaced'] as const)(
  'a %s target change settles at the new latency without skipping ticks or orders',
  async (scenario) => {
    let now = 0;
    const finalTarget = scenario === 'replaced' ? 3 : 1;
    const steady = await runningClient(finalTarget, () => now);
    const changed = await runningClient(2, () => now);
    const peers = [steady, changed];
    let emitted = 0;
    let frameTime = 0;
    let held = false;
    let reconnectTick: number | null = null;
    const pause = (paused: boolean): void => {
      for (const { client } of peers)
        client.receive({ kind: 'clock', tick: emitted + 1, speed: 1, paused, by: null, governed: null });
    };
    for (now = STEP_MS; now <= 16_000; now += STEP_MS) {
      if (now === 5000) {
        if (scenario === 'paused' || scenario === 'reconnecting') {
          held = true;
          pause(true);
          if (scenario === 'reconnecting') {
            changed.client.hello();
            reconnectTick = changed.client.tick;
          }
        } else select(changed.client, 1);
      }
      if (now === 5010 && scenario === 'replaced') select(changed.client, finalTarget);
      if (now === 5500 && held) select(changed.client, finalTarget);
      if (now === 6000 && held) {
        if (scenario === 'reconnecting') {
          expect(changed.client.tick).toBe(reconnectTick);
          changed.client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
        }
        held = false;
        pause(false);
      }
      if (!held) frameTime += STEP_MS;
      while (frameTime >= TICK_MS) {
        frameTime -= TICK_MS;
        emitted++;
        for (const { client } of peers)
          client.receive({
            kind: 'frame',
            tick: emitted,
            commands: [
              {
                sequence: 0,
                envelope: playerCommand(0, {
                  kind: 'setAssistantCounter',
                  player: 0,
                  counter: 'extraMen',
                  value: emitted,
                  infinite: false,
                }),
              },
            ],
          });
      }
      for (const { client } of peers) client.advance(STEP_MS);
    }
    expect(Math.abs(medianDifference(changed.applied, steady.applied, 30, 50))).toBeGreaterThan(50);
    expect(Math.abs(medianDifference(changed.applied, steady.applied, 100, 150))).toBeLessThanOrEqual(20);
    pause(true);
    for (let step = 0; step < 200; step++) {
      now += STEP_MS;
      for (const { client } of peers) client.advance(STEP_MS);
    }
    for (const { client, applied } of peers) {
      expect([...applied.keys()]).toEqual(Array.from({ length: emitted }, (_, i) => i + 1));
      expect(client.sim?.commands.log).toHaveLength(emitted);
      expect(client.sim?.hashState()).toBe(steady.client.sim?.hashState());
    }
  },
);
