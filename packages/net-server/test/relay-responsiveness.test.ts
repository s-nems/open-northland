import { Relay } from '@open-northland/net-server';
import { playerCommand, restoreSimulation, Simulation } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import * as pacer from '../../net-client/src/pacer.js';
import { testContent } from '../../sim/test/fixtures/content.js';
import { HeadlessClient } from './support/headless-client.js';
import { assembleRoom, runUntil, type Stage, settle } from './support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

const scenarios = [
  { count: 2, rtt: 40, jitter: 10, speed: 1 },
  { count: 8, rtt: 120, jitter: 40, speed: 1 },
  { count: 8, rtt: 300, jitter: 160, speed: 1 },
  { count: 8, rtt: 120, jitter: 40, speed: 4 },
  { count: 8, rtt: 300, jitter: 160, speed: 8 },
];
const STEP_MS = 5;
const WARMUP_MS = 20_000;
const MEASURE_MS = 40_000;
// Experiments affect this harness only. Run with --disableConsoleIntercept to retain the report.
const VARIANTS = { current: 0, one: 1, none: 2 } as const;

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

describe('relay command responsiveness', () => {
  it.each(scenarios)('$count clients, $rtt ms RTT, $jitter ms jitter, speed $speed', async (scenario) => {
    const clock = new VirtualClock();
    const relay = new Relay({ now: clock.now });
    const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(917)) };
    const random = seededRandom(718);
    const clients = Array.from(
      { length: scenario.count },
      (_, seat) =>
        new HeadlessClient({
          token: `latency-player-${seat}-0123456789`,
          nick: `Player${seat}`,
          buildWorld: async (session) => new Simulation({ seed: session.seed, content: testContent() }),
          restoreWorld: async (_session, save) => restoreSimulation(save, { content: testContent() }),
        }),
    );
    const originalPace = pacer.paceScale;
    const variant = process.env.ON_NET_PACING ?? 'current';
    if (variant !== 'current' && variant !== 'one' && variant !== 'none')
      throw new Error(`Unknown ON_NET_PACING: ${variant}`);
    const offset = VARIANTS[variant];
    const changed =
      offset === 0
        ? null
        : vi
            .spyOn(pacer, 'paceScale')
            .mockImplementation((buffered, speed) => originalPace(buffered + offset, speed));
    try {
      for (const client of clients)
        stage.network.link(client, {
          latencyMs: scenario.rtt,
          jitterMs: scenario.jitter,
          uploadBytesPerSecond: 128 * 1024,
          downloadBytesPerSecond: 512 * 1024,
        });
      await assembleRoom(stage, clients, {
        settings: {
          name: 'latency',
          world: { kind: 'scene', sceneId: 'fixture' },
          seed: 3,
          rules: { fog: null, progression: null, needs: null, weather: null },
          speed: scenario.speed,
        },
        seats: clients.map((_, player) => ({ player, mode: 'idle', offers: ['idle', 'ai'], color: player })),
        seatOf: (seat) => seat,
        settleMs: 1000,
      });
      const start = clock.now();
      const sent = new Map<number, number>();
      const samples: number[] = [];
      const gaps: number[] = [];
      const nextOrder = clients.map(() => start + WARMUP_MS + random() * 1000);
      const previousTickAt = clients.map(() => 0);
      const readCommands = clients.map(() => 0);
      let order = 0;
      for (let elapsed = 0; elapsed < WARMUP_MS + MEASURE_MS + 5000; elapsed += STEP_MS) {
        settle(stage, STEP_MS);
        for (const [seat, client] of clients.entries()) {
          const due = nextOrder[seat] ?? Infinity;
          if (clock.now() >= due && elapsed < WARMUP_MS + MEASURE_MS) {
            const value = ++order;
            sent.set(value, clock.now());
            client.submit(
              playerCommand(seat, {
                kind: 'setAssistantCounter',
                player: seat,
                counter: 'extraMen',
                value,
                infinite: false,
              }),
            );
            nextOrder[seat] = clock.now() + 570 + random() * 400;
          }
          client.advance(STEP_MS, () => {
            if (elapsed >= WARMUP_MS && elapsed < WARMUP_MS + MEASURE_MS) {
              const previous = previousTickAt[seat] ?? 0;
              if (previous > 0) gaps.push(clock.now() - previous);
              previousTickAt[seat] = clock.now();
            }
            const log = client.sim?.commands.log ?? [];
            for (let index = readCommands[seat] ?? 0; index < log.length; index++) {
              const command = log[index]?.command;
              if (command?.kind !== 'setAssistantCounter' || command.player !== seat) continue;
              const issued = sent.get(command.value);
              if (issued !== undefined) samples.push(clock.now() - issued);
            }
            readCommands[seat] = log.length;
          });
        }
        await Promise.all(clients.map((client) => client.settled()));
      }
      expect(samples).toHaveLength(sent.size);
      // A seconds-long backlog is a regression even when every command eventually arrives.
      expect(percentile(samples, 0.95)).toBeLessThan(scenario.rtt * 2 + 250);
      const target = Math.max(...clients.map((client) => client.tick ?? 0)) + 10;
      const captures = await runUntil(stage, clients, target);
      expect(new Set([...captures.values()].map(({ hash }) => hash)).size).toBe(1);
      for (const client of clients) {
        expect(client.rejections, client.nick).toEqual([]);
        expect(client.errors, client.nick).toEqual([]);
        expect(client.desyncs, client.nick).toEqual([]);
      }
      if (process.env.ON_NET_LATENCY_REPORT === 'on')
        console.info(
          JSON.stringify({
            ...scenario,
            variant,
            samples: samples.length,
            commandMs: {
              p50: percentile(samples, 0.5),
              p95: percentile(samples, 0.95),
              max: Math.max(...samples),
            },
            tickGapMs: { p50: percentile(gaps, 0.5), p95: percentile(gaps, 0.95), max: Math.max(...gaps) },
          }),
        );
    } finally {
      changed?.mockRestore();
    }
  });
});
