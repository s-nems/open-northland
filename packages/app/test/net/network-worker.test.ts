import { MessageChannel } from 'node:worker_threads';
import type { GameSession } from '@open-northland/lockstep';
import { DISPUTE_WINDOW_TICKS, type RelayLinkEvents } from '@open-northland/net-client';
import {
  type ClientMessage,
  DESCRIPTOR_WORLD,
  MAX_SPEED,
  PROTOCOL_VERSION,
  TICK_MS,
} from '@open-northland/net-protocol';
import { GOVERN_BEHIND_MS } from '@open-northland/net-server';
import { afterEach, expect, it } from 'vitest';
import type { MapWorkerBoot, MapWorldPlacements } from '../../src/entries/map/world-inputs.js';
import { type HostedRelayedWorld, NetworkConnection } from '../../src/net/connection.js';
import { relayedSessionDriver } from '../../src/net/net-worker-client.js';
import { createSceneSim, SCENES } from '../../src/scenes/index.js';
import { type RelayLinkFactory, serveRelay } from '../../src/session/worker/net-serve.js';
import type { RelayedWorldBuilder } from '../../src/session/worker/net-world-port.js';
import { nodeParentPort } from '../support/session-worker/node-ports.js';
import { DEFAULT_TEST_OPTIONS } from '../support/session-worker/start-worker.js';

const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'sandbox' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
const FRAMES = 5;
const DISPUTED_TICK = 3;
/** A polling interval while the other end of an in-process channel works. */
const TURN_MS = 5;
const WAIT_LIMIT_MS = 10_000;

/** The relay as the worker's client sees it: what the client sent, and the relay's side to play. */
function testLink() {
  const sent: ClientMessage[] = [];
  let events: RelayLinkEvents | null = null;
  let connected = false;
  const state = { opened: false, closed: false };
  const factory: RelayLinkFactory = (_url, linkEvents) => {
    events = linkEvents;
    state.opened = true;
    return {
      get connected() {
        return connected;
      },
      send: (message) => {
        if (connected) sent.push(message);
        return connected;
      },
      close: () => {
        connected = false;
        state.closed = true;
      },
    };
  };
  return {
    factory,
    sent,
    state,
    open(): void {
      connected = true;
      events?.onOpen();
    },
    deliver: (raw: unknown) => events?.onMessage(raw),
  };
}

/** The sandbox scene for whatever the runtime assembled: the test runs no map. */
const buildSandbox: RelayedWorldBuilder<MapWorkerBoot, MapWorldPlacements> = () => {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  return {
    sim: createSceneSim(scene),
    extras: { harvestablePlacements: [], pooledPlacements: [] },
    generation: DESCRIPTOR_WORLD,
  };
};

async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + WAIT_LIMIT_MS;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, TURN_MS));
  }
}

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

it('walks the lobby, hosts the started world and runs the relay frames through the worker', async () => {
  const channel = new MessageChannel();
  channels.push(channel);
  const link = testLink();
  serveRelay(nodeParentPort(channel.port1), buildSandbox, link.factory);
  const connection = new NetworkConnection(
    'ws://relay.test',
    { token: 'token-0123456789abcdef', nick: 'Ania' },
    () => nodeParentPort(channel.port2),
  );
  const worlds: HostedRelayedWorld[] = [];
  connection.bindWorld(
    {
      open: async (_session, _tick, host) => {
        await host({} as MapWorkerBoot, { ...DEFAULT_TEST_OPTIONS, paused: false, undelivered: 'shed' });
      },
      restore: async () => undefined,
    },
    (world) => worlds.push(world),
  );
  await until(() => link.state.opened);
  link.open();
  await until(() => connection.connected);
  expect(link.sent[0]).toMatchObject({ kind: 'hello', nick: 'Ania' });

  link.deliver({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  await until(() => connection.client.welcomed);
  connection.client.listRooms();
  await until(() => link.sent.some((message) => message.kind === 'listRooms'));

  link.deliver({ kind: 'start', session: SESSION, snapshotTick: null });
  await until(() => worlds.length === 1);
  const [world] = worlds;
  if (world === undefined) throw new Error('no world');
  expect(world.worldId).toBe(1);
  expect(connection.client.worldId).toBe(1);
  expect(link.sent).toContainEqual({ kind: 'loaded', tick: 0, world: DESCRIPTOR_WORLD });

  for (let tick = 1; tick <= FRAMES; tick++) link.deliver({ kind: 'frame', tick, commands: [] });
  const driver = relayedSessionDriver(world.session.driver, connection.client);
  await until(() => {
    driver.advance(0);
    return world.session.host.tick >= FRAMES;
  });
  expect(link.sent.filter((message) => message.kind === 'ack').map((message) => message.tick)).toEqual([
    1, 2, 3, 4, 5,
  ]);
  const digests = await connection.digests();
  expect(digests.map((digest) => digest.tick)).toEqual([1, 2, 3, 4, 5]);

  link.deliver({ kind: 'disputed', tick: DISPUTED_TICK, domains: ['rng'], diverged: ['Bartek'] });
  const dispute = await connection.dispute();
  expect(dispute).toMatchObject({ role: 'reference', tick: DISPUTED_TICK, counterparts: ['Bartek'] });
  expect(dispute?.inputs?.tick).toBe(DISPUTED_TICK);

  world.session.dispose();
  connection.dispose();
  await until(() => link.state.closed);
});

it('keeps disputed inputs for longer than the relay lets a member trail at the top speed', () => {
  expect(DISPUTE_WINDOW_TICKS).toBeGreaterThan((GOVERN_BEHIND_MS / TICK_MS) * MAX_SPEED);
});
