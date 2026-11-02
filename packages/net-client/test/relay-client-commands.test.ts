import type { GameSession } from '@open-northland/lockstep';
import { RelayClient } from '@open-northland/net-client';
import {
  type ClientMessage,
  MAX_COMMANDS_PER_TICK,
  type ServerMessage,
  TICK_MS,
} from '@open-northland/net-protocol';
import { type CommandEnvelope, playerCommand, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { MAX_QUEUED_COMMANDS } from '../src/pacing/command-outbox.js';

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
const RESTORED_TICK = 20;

function order(value: number): CommandEnvelope {
  return playerCommand(0, {
    kind: 'setAssistantCounter',
    player: 0,
    counter: 'extraMen',
    value,
    infinite: false,
  });
}

function fixtureWorld(ticks = 0): Simulation {
  const sim = new Simulation({ seed: SESSION.seed, content: testContent() });
  for (let i = 0; i < ticks; i++) sim.step();
  return sim;
}

async function runningClient(options: { snapshotTick?: number | null; connected?: () => boolean } = {}) {
  const clock = { now: 0 };
  const sent: ClientMessage[] = [];
  const observed: ServerMessage[] = [];
  const client = new RelayClient({
    token: 'relay-commands-0123456789',
    nick: 'Ania',
    now: () => clock.now,
    ...(options.connected === undefined ? {} : { connected: options.connected }),
    world: {
      open: async (_session, snapshotTick) => ({
        sim: fixtureWorld(snapshotTick ?? 0),
        generation: snapshotTick ?? 0,
      }),
      restore: async () => ({ sim: fixtureWorld(RESTORED_TICK), generation: RESTORED_TICK }),
    },
    onMessage: (message) => observed.push(message),
  });
  client.attach((message) => sent.push(message));
  client.receive({ kind: 'start', session: SESSION, snapshotTick: options.snapshotTick ?? null });
  await client.settled();
  sent.length = 0;
  observed.length = 0;
  const commandsSent = () => sent.filter((message) => message.kind === 'command');
  return { client, clock, sent, observed, commandsSent };
}

/** The relay's clock at `tick`, as it follows `start` on a socket that returns to a running game. */
function clockAt(tick: number): ServerMessage {
  return { kind: 'clock', tick, speed: 1, paused: false, by: null, governed: null };
}

/** Deliver the frame for the client's next tick carrying `commands`, then run it. */
function applyNext(client: RelayClient, envelopes: readonly CommandEnvelope[]): void {
  const tick = (client.tick ?? 0) + 1;
  const commands = envelopes.map((envelope, sequence) => ({ envelope, sequence }));
  client.receive({ kind: 'frame', tick, commands });
  client.advance(TICK_MS * 2);
}

describe('click-to-apply stamps', () => {
  it('forgets a command whose frame a restored snapshot already covers', async () => {
    const { client, clock } = await runningClient();
    client.receive(clockAt(0));
    client.submit(order(1));
    client.receive({ kind: 'desync', tick: 1, domains: ['rng'], reference: 'Bartek' });
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: RESTORED_TICK, bytes: 'AAAA' });
    await client.settled();
    clock.now = 60_000;
    client.submit(order(2));
    clock.now = 60_250;
    applyNext(client, [order(2)]);
    expect(client.latency.lastMs).toBe(250);
  });

  it('holds new commands until the ones a replaced socket delivered have applied, measuring none of those', async () => {
    const { client, clock, commandsSent } = await runningClient();
    client.submit(order(1));
    client.hello();
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    client.receive(clockAt(0));
    clock.now = 60_000;
    client.submit(order(2));
    expect(commandsSent().map((message) => message.envelope)).toEqual([order(1)]);
    applyNext(client, [order(1)]);
    expect(client.latency.lastMs).toBeNull();
    expect(commandsSent().map((message) => message.envelope)).toEqual([order(1), order(2)]);
    clock.now = 60_250;
    applyNext(client, [order(2)]);
    expect(client.latency.lastMs).toBe(250);
    expect(client.latency.inFlight).toBe(0);
  });

  it('forgets a command the replaced socket lost once the relay could no longer land it', async () => {
    const { client, clock, commandsSent } = await runningClient();
    client.submit(order(1));
    client.hello();
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    client.receive(clockAt(0));
    clock.now = 60_000;
    client.submit(order(2));
    applyNext(client, []);
    expect(commandsSent().map((message) => message.envelope)).toEqual([order(1), order(2)]);
    clock.now = 60_250;
    applyNext(client, [order(2)]);
    expect(client.latency.lastMs).toBe(250);
    expect(client.latency.inFlight).toBe(0);
  });
});

describe('local refusals', () => {
  it('tells the host about an order given with no world', async () => {
    const { client, observed, commandsSent } = await runningClient();
    client.receive({ kind: 'desync', tick: 1, domains: ['rng'], reference: 'Bartek' });
    observed.length = 0;
    client.submit(order(1));
    expect(commandsSent()).toHaveLength(0);
    expect(observed).toEqual([{ kind: 'rejected', of: 'command', reason: { code: 'notLoaded' } }]);
  });
});

describe('the outbox under the relay per-tick budget', () => {
  it('carries gestures past the budget over until earlier ones apply, in order', async () => {
    const { client, commandsSent } = await runningClient();
    const burst = Array.from({ length: MAX_COMMANDS_PER_TICK + 1 }, (_, i) => order(i));
    for (const envelope of burst) client.submit(envelope);
    expect(commandsSent().map((message) => message.envelope)).toEqual(burst.slice(0, MAX_COMMANDS_PER_TICK));
    applyNext(client, burst.slice(0, 1));
    expect(commandsSent().map((message) => message.envelope)).toEqual(burst);
  });

  it('sends a held gesture when the relay refuses an earlier one', async () => {
    const { client, commandsSent } = await runningClient();
    for (let i = 0; i <= MAX_COMMANDS_PER_TICK; i++) client.submit(order(i));
    client.receive({ kind: 'rejected', of: 'command', reason: { code: 'commandBudget' } });
    expect(commandsSent()).toHaveLength(MAX_COMMANDS_PER_TICK + 1);
  });

  it('refuses a gesture locally once the outbox is full', async () => {
    const { client, observed, commandsSent } = await runningClient();
    for (let i = 0; i < MAX_COMMANDS_PER_TICK + MAX_QUEUED_COMMANDS + 1; i++) client.submit(order(i));
    expect(commandsSent()).toHaveLength(MAX_COMMANDS_PER_TICK);
    expect(observed).toEqual([{ kind: 'rejected', of: 'command', reason: { code: 'commandBudget' } }]);
  });

  it('holds an order given while disconnected and sends it once the room takes the world back', async () => {
    let connected = true;
    const { client, commandsSent, observed } = await runningClient({ connected: () => connected });
    connected = false;
    client.submit(order(1));
    expect(commandsSent()).toHaveLength(0);
    connected = true;
    client.hello();
    client.advance(TICK_MS);
    expect(commandsSent()).toHaveLength(0);
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    client.advance(TICK_MS);
    expect(commandsSent().map((message) => message.envelope)).toEqual([order(1)]);
    expect(observed.filter((message) => message.kind === 'rejected')).toEqual([]);
  });

  it('holds every order on a new socket until the room admits the world again', async () => {
    let connected = true;
    const { client, commandsSent } = await runningClient({ connected: () => connected });
    connected = false;
    client.submit(order(1));
    connected = true;
    client.hello();
    client.submit(order(2));
    expect(commandsSent()).toHaveLength(0);
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    client.advance(TICK_MS);
    expect(commandsSent().map((message) => message.envelope)).toEqual([order(1), order(2)]);
  });

  it('holds an order given while disconnected for the world a return is served as a snapshot', async () => {
    let connected = true;
    const { client, commandsSent, observed } = await runningClient({ connected: () => connected });
    connected = false;
    client.submit(order(1));
    connected = true;
    client.hello();
    client.receive({ kind: 'start', session: SESSION, snapshotTick: RESTORED_TICK });
    client.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: RESTORED_TICK, bytes: 'AAAA' });
    await client.settled();
    applyNext(client, []);
    expect(client.tick).toBe(RESTORED_TICK + 1);
    expect(commandsSent().map((message) => message.envelope)).toEqual([order(1)]);
    expect(observed.filter((message) => message.kind === 'rejected')).toEqual([]);
  });

  it('drops the held orders of a room the client leaves', async () => {
    let connected = true;
    const { client, commandsSent } = await runningClient({ connected: () => connected });
    connected = false;
    client.submit(order(1));
    client.receive({ kind: 'left' });
    connected = true;
    client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    await client.settled();
    applyNext(client, []);
    expect(commandsSent()).toEqual([]);
  });
});

describe('snapshot requests', () => {
  const uploads = (sent: readonly ClientMessage[]) => sent.filter((message) => message.kind === 'blob');

  it('skips the export while its world is behind the snapshot the relay caches', async () => {
    const cached = 5;
    const { client, sent } = await runningClient();
    // A returning client whose world stands before the cache replays the frames after it.
    client.hello();
    client.receive({ kind: 'start', session: SESSION, snapshotTick: cached });
    sent.length = 0;
    client.receive({ kind: 'snapshotRequest' });
    await client.settled();
    expect(client.tick).toBeLessThan(cached);
    expect(uploads(sent)).toHaveLength(0);
  });

  it('still answers at the cached tick, which can vouch for a held copy', async () => {
    const cached = 5;
    const { client, sent } = await runningClient({ snapshotTick: cached });
    client.receive({ kind: 'snapshotRequest' });
    await client.settled();
    expect(uploads(sent)).toMatchObject([{ type: 'snapshot', tick: cached }]);
  });
});
