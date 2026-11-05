import type { MessageChannel } from 'node:worker_threads';
import type { GameSession } from '@open-northland/lockstep';
import type { RelayLinkEvents } from '@open-northland/net-client';
import { type ClientMessage, DESCRIPTOR_WORLD } from '@open-northland/net-protocol';
import type { MapWorkerBoot, MapWorldPlacements } from '../../../src/entries/map/world-inputs.js';
import { type HostedRelayedWorld, NetworkConnection } from '../../../src/net/connection.js';
import { createSceneSim, SCENES } from '../../../src/scenes/index.js';
import { type RelayLinkFactory, serveRelay } from '../../../src/session/worker/net-serve.js';
import type { RelayedWorldBuilder } from '../../../src/session/worker/net-world-port.js';
import { nodeParentPort } from '../session-worker/node-ports.js';
import { DEFAULT_TEST_OPTIONS } from '../session-worker/start-worker.js';

/**
 * The network worker served in this thread over a `MessageChannel`, with the relay played by the test:
 * what the worker's client sends lands in `sent`, and `deliver` hands it a relay message.
 */

/** A polling interval while the other end of an in-process channel works. */
const TURN_MS = 5;
const WAIT_LIMIT_MS = 10_000;

export const SANDBOX_SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'sandbox' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
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

/** The relay as the worker's client sees it: what the client sent, and the relay's side to play. */
export function testLink() {
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
export const buildSandbox: RelayedWorldBuilder<MapWorkerBoot, MapWorldPlacements> = () => {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  return {
    sim: createSceneSim(scene),
    extras: { harvestablePlacements: [], pooledPlacements: [] },
    generation: DESCRIPTOR_WORLD,
  };
};

/** Resolves once `check` holds; `state` describes what a timeout found. */
export async function until(check: () => boolean, state?: () => string): Promise<void> {
  const deadline = performance.now() + WAIT_LIMIT_MS;
  while (!check()) {
    if (performance.now() > deadline)
      throw new Error(`timed out${state === undefined ? '' : `: ${state()}`}`);
    await new Promise((resolve) => setTimeout(resolve, TURN_MS));
  }
}

/** A round trip through the worker: every message posted before it has been acted on. */
export const settles = (connection: NetworkConnection): Promise<unknown> => connection.digests();

/** A connection over `channel` to a network worker served in this thread. */
export function inProcessConnection(channel: MessageChannel, link: ReturnType<typeof testLink>) {
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
        await host({} as MapWorkerBoot, { ...DEFAULT_TEST_OPTIONS, paused: false });
      },
      restore: async () => undefined,
    },
    (world) => worlds.push(world),
  );
  return { connection, worlds };
}
