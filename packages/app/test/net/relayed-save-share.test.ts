import { MessageChannel } from 'node:worker_threads';
import type { GameSession } from '@open-northland/lockstep';
import { base64ToBytes, decodeSnapshot } from '@open-northland/net-client';
import { type ClientMessage, DESCRIPTOR_WORLD, PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { serializeSaveGame } from '@open-northland/sim';
import { afterEach, expect, it } from 'vitest';
import type { MapWorkerBoot, MapWorldPlacements } from '../../src/entries/map/world-inputs.js';
import { type HostedRelayedWorld, NetworkConnection } from '../../src/net/connection.js';
import { relayedSessionDriver } from '../../src/net/net-worker-client.js';
import { networkSaveSession } from '../../src/net/save-session.js';
import { createSceneSim, restoreSceneSim, SCENES } from '../../src/scenes/index.js';
import { serveRelay } from '../../src/session/worker/net-serve.js';
import type { RelayedWorldBuilder } from '../../src/session/worker/net-world-port.js';
import { decodeSaveText, isGzipSave } from '../../src/view/runtime/save-load/codec.js';
import { type FromWorkerLink, portLinkFactory, type ToWorkerLink } from '../support/net-worker/port-link.js';
import { nodeParentPort } from '../support/session-worker/node-ports.js';
import { DEFAULT_TEST_OPTIONS } from '../support/session-worker/start-worker.js';

const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'sandbox' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
/** Ticks the shared world runs first: the relay refuses a save at tick 0. */
const FRAMES = 5;
const SAVED_AT_MS = 1_700_000_000_000;
/** A polling interval while the other end of an in-process channel works. */
const TURN_MS = 5;
const WAIT_LIMIT_MS = 10_000;

const sandbox = SCENES.find((candidate) => candidate.id === 'sandbox');
if (sandbox === undefined) throw new Error('no sandbox scene');

const buildSandbox: RelayedWorldBuilder<MapWorkerBoot, MapWorldPlacements> = () => ({
  sim: createSceneSim(sandbox),
  extras: { harvestablePlacements: [], pooledPlacements: [] },
  generation: DESCRIPTOR_WORLD,
});

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

it("carries the worker's gzipped save to the relay once, and a peer restores the sharer's world", async () => {
  const [session, link] = [new MessageChannel(), new MessageChannel()];
  channels.push(session, link);
  serveRelay(nodeParentPort(session.port1), buildSandbox, portLinkFactory(link.port1));
  // The relay's side of the link: it records what the client sent and answers a save's order request.
  const sent: ClientMessage[] = [];
  const relay = (raw: unknown): void =>
    link.port2.postMessage({ kind: 'message', raw } satisfies ToWorkerLink);
  link.port2.on('message', (out: FromWorkerLink) => {
    if (out.kind !== 'send') return;
    sent.push(out.message);
    const { message } = out;
    if (message.kind === 'saveOrders')
      relay({ kind: 'saveOrders', id: message.id, tick: message.tick, frames: [] });
  });

  const connection = new NetworkConnection(
    'ws://relay.test',
    { token: 'token-0123456789abcdef', nick: 'Ania' },
    () => nodeParentPort(session.port2),
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
  link.port2.postMessage({ kind: 'open' } satisfies ToWorkerLink);
  await until(() => connection.connected);
  relay({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  relay({ kind: 'start', session: SESSION, snapshotTick: null });
  await until(() => worlds.length === 1);
  const [world] = worlds;
  if (world === undefined) throw new Error('no world');
  const driver = relayedSessionDriver(world.session.driver, connection.client);
  for (let tick = 1; tick <= FRAMES; tick++) relay({ kind: 'frame', tick, commands: [] });
  await until(() => {
    driver.advance(0);
    return world.session.host.tick >= FRAMES;
  });

  const sharer = await world.session.host.hashState();
  const file = await world.session.captureSaveFile({ savedAt: SAVED_AT_MS });
  expect(file.header.tick).toBe(sharer.tick);
  expect(isGzipSave(file.bytes)).toBe(true);
  const hooks = networkSaveSession(connection.client, world.worldId);
  await hooks.onSaved?.(file);

  const uploads = (): ClientMessage[] =>
    sent.filter((message) => message.kind === 'blob' && message.type === 'save');
  // The link's port and the session's port deliver independently: the upload may trail the answer.
  await until(() => uploads().length > 0);
  expect(uploads()).toHaveLength(1);
  const [upload] = uploads();
  if (upload?.kind !== 'blob') throw new Error('no uploaded save');
  expect(upload).toMatchObject({ to: null, tick: sharer.tick });
  // The wire carries the worker's own bytes: base64 of them, never compressed or serialized again.
  const wire = base64ToBytes(upload.bytes);
  expect(wire).toEqual(file.bytes);
  const peerSave = await decodeSnapshot(upload.bytes);
  expect(await decodeSaveText(wire)).toBe(serializeSaveGame(peerSave));
  const peer = restoreSceneSim(sandbox, peerSave);
  expect(peer.tick).toBe(sharer.tick);
  expect(peer.hashState()).toEqual(sharer.hash);

  // The same capture as plain JSON is refused before it reaches the relay.
  const plain = new TextEncoder().encode(serializeSaveGame(peerSave));
  await expect(hooks.onSaved?.({ header: file.header, bytes: plain })).rejects.toThrow('gzip');
  expect(uploads()).toHaveLength(1);

  world.session.dispose();
  connection.dispose();
});
