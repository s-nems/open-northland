import { MAX_COMMANDS_PER_TICK, MAX_ENVELOPE_BYTES, type RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { playerCommand, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../../sim/test/fixtures/content.js';
import { HeadlessClient } from '../support/headless-client.js';
import { assembleRoom, relink, runFor, type Stage } from '../support/session-run.js';
import { restoreTestWorld } from '../support/test-world.js';
import { type Link, seededRandom, VirtualClock, VirtualNetwork } from '../support/virtual-network.js';

const SEED = 7;
const settings: RoomSettings = {
  name: 'command budget',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: SEED,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
/** A wall line of twenty edges: its anchor and twenty nodes, one gesture each, in one click. */
const WALL_LINE_GESTURES = MAX_COMMANDS_PER_TICK + 1;
const PAUSED_ORDERS = 30;
const LINK = { latencyMs: 70, jitterMs: 30 };
const SETTLE_MS = 500;
const RUN_MS = 3000;
/** Long enough for a replaced socket's `start` and `clock` to arrive and its world to be admitted. */
const REJOIN_MS = 1000;
/** Orders given after the socket replacement, told apart from the ones before it by value. */
const AFTER_REJOIN_VALUE = 100;

function client(nick: string): HeadlessClient {
  return new HeadlessClient({
    token: `${nick}-0123456789abcdef`,
    nick,
    buildWorld: async () => new Simulation({ seed: SEED, content: testContent() }),
    restoreWorld: restoreTestWorld,
  });
}

async function room(): Promise<{
  stage: Stage;
  clients: readonly [HeadlessClient, HeadlessClient];
  links: readonly Link[];
}> {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(29)) };
  const clients = [client('Ania'), client('Bartek')] as const;
  const links = clients.map((c) => stage.network.link(c, LINK));
  await assembleRoom(stage, clients, {
    settings,
    seats: [0, 1].map((player) => ({
      player,
      mode: 'idle' as const,
      claimable: true,
      offers: ['idle' as const, 'computer' as const],
      color: player,
    })),
    seatOf: (i) => i,
    settleMs: SETTLE_MS,
  });
  await runFor(stage, clients, SETTLE_MS);
  return { stage, clients, links };
}

function counterOrder(value: number) {
  return playerCommand(0, {
    kind: 'setAssistantCounter',
    player: 0,
    counter: 'extraMen',
    value,
    infinite: false,
  });
}

/** The values of seat 0's counter orders as `observer` applied them, with their ticks. */
function applied(observer: HeadlessClient): { values: number[]; ticks: Set<number> } {
  const values: number[] = [];
  const ticks = new Set<number>();
  for (const entry of observer.sim?.commands.log ?? []) {
    if (entry.command.kind !== 'setAssistantCounter') continue;
    values.push(entry.command.value);
    ticks.add(entry.applyTick);
  }
  return { values, ticks };
}

describe('gestures past the relay per-tick budget', () => {
  it('lands a whole wall line over successive ticks instead of losing its last node', async () => {
    const { stage, clients } = await room();
    const [ania, bartek] = clients;
    const values = Array.from({ length: WALL_LINE_GESTURES }, (_, i) => i);
    for (const value of values) ania.submit(counterOrder(value));
    await runFor(stage, clients, RUN_MS);
    expect(ania.rejections).toEqual([]);
    for (const observer of clients) {
      const seen = applied(observer);
      expect(seen.values).toEqual(values);
      expect(seen.ticks.size).toBeGreaterThan(1);
    }
    expect(ania.sim?.hashState()).toBe(bartek.sim?.hashState());
  });

  it('keeps every order given while paused, and applies them in order once the game resumes', async () => {
    const { stage, clients } = await room();
    const [ania, bartek] = clients;
    ania.setPaused(true);
    await runFor(stage, clients, SETTLE_MS);
    const values = Array.from({ length: PAUSED_ORDERS }, (_, i) => i);
    for (const value of values) ania.submit(counterOrder(value));
    await runFor(stage, clients, SETTLE_MS);
    ania.setPaused(false);
    await runFor(stage, clients, RUN_MS);
    expect(ania.rejections).toEqual([]);
    for (const observer of clients) expect(applied(observer).values).toEqual(values);
    expect(ania.sim?.hashState()).toBe(bartek.sim?.hashState());
  });

  it('counts the orders a replaced socket delivered, so the ones after it are not refused', async () => {
    const { stage, clients, links } = await room();
    const [ania, bartek] = clients;
    ania.setPaused(true);
    await runFor(stage, clients, SETTLE_MS);
    const before = Array.from({ length: MAX_COMMANDS_PER_TICK }, (_, i) => i);
    for (const value of before) ania.submit(counterOrder(value));
    await runFor(stage, clients, SETTLE_MS);
    links[0]?.close();
    relink(stage, ania, LINK);
    await runFor(stage, clients, REJOIN_MS);
    const after = before.map((value) => AFTER_REJOIN_VALUE + value);
    for (const value of after) ania.submit(counterOrder(value));
    await runFor(stage, clients, SETTLE_MS);
    ania.setPaused(false);
    await runFor(stage, clients, RUN_MS);
    expect(ania.rejections).toEqual([]);
    for (const observer of clients) expect(applied(observer).values).toEqual([...before, ...after]);
    expect(ania.latency.inFlight).toBe(0);
    expect(ania.sim?.hashState()).toBe(bartek.sim?.hashState());
  });

  it('lands large orders over successive ticks instead of crossing the byte budget of one', async () => {
    const { stage, clients } = await room();
    const [ania, bartek] = clients;
    // A group order filled to the budget: the order changes nothing, only its size matters. Its first
    // job entry is one serialized byte, every later one two, and a two-digit last one adds the odd byte.
    const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    // An id no world holds: the order changes nothing, only its size matters.
    const entity = new Simulation({ seed: SEED, content: testContent() }).world.create();
    const base = jsonBytes(
      playerCommand(0, {
        kind: 'assignWorkerGroup',
        building: entity,
        members: [{ entity, jobPriority: [0] }],
      }),
    );
    const largest = (): ReturnType<typeof playerCommand> => {
      const entries = Math.floor((MAX_ENVELOPE_BYTES - base) / 2) + 1;
      const jobPriority = new Array<number>(entries).fill(0);
      if ((MAX_ENVELOPE_BYTES - base) % 2 === 1) jobPriority[entries - 1] = 10;
      return playerCommand(0, {
        kind: 'assignWorkerGroup',
        building: entity,
        members: [{ entity, jobPriority }],
      });
    };
    const orders = [largest(), largest(), largest()];
    for (const order of orders) ania.submit(order);
    await runFor(stage, clients, RUN_MS);
    expect(ania.rejections).toEqual([]);
    expect(ania.latency.inFlight).toBe(0);
    expect(ania.sim?.hashState()).toBe(bartek.sim?.hashState());
  });
});
