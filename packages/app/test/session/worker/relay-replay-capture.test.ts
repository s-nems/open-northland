import { MessageChannel } from 'node:worker_threads';
import { DESCRIPTOR_WORLD, PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { afterEach, expect, it } from 'vitest';
import type { MapWorkerBoot, MapWorldPlacements } from '../../../src/entries/map/world-inputs.js';
import { type HostedRelayedWorld, NetworkConnection } from '../../../src/net/connection.js';
import { relayedSessionDriver } from '../../../src/net/net-worker-client.js';
import { createSceneSim, SCENES } from '../../../src/scenes/index.js';
import { serveRelay } from '../../../src/session/worker/net-serve.js';
import type { RelayedWorldBuilder } from '../../../src/session/worker/net-world-port.js';
import { decodeSaveText } from '../../../src/view/runtime/save-load/codec.js';
import {
  parseReplayDocument,
  REPLAY_FORMAT_VERSION,
  REPLAY_KIND,
} from '../../../src/view/runtime/save-load/replay.js';
import { SANDBOX_SESSION, testLink, until } from '../../support/net-worker/in-process-relay.js';
import { nodeParentPort } from '../../support/session-worker/node-ports.js';
import { DEFAULT_TEST_OPTIONS } from '../../support/session-worker/start-worker.js';

const FRAMES = 5;

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The sandbox scene as a relayed world that pins its recording: what a fresh room's builder returns. */
const buildRecordingSandbox: RelayedWorldBuilder<MapWorkerBoot, MapWorldPlacements> = () => {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  return {
    sim: createSceneSim(scene),
    extras: { harvestablePlacements: [], pooledPlacements: [] },
    generation: DESCRIPTOR_WORLD,
    replaySource: { descriptor: SANDBOX_SESSION, fromTick: 0, initialSaveText: null },
  };
};

/** A connection over `channel` to a network worker whose world builder pins the recording. */
function recordingConnection(channel: MessageChannel, link: ReturnType<typeof testLink>) {
  serveRelay(nodeParentPort(channel.port1), buildRecordingSandbox, link.factory);
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

it('records a relayed session from its own log: the capture carries the descriptor and the frames', async () => {
  const channel = new MessageChannel();
  channels.push(channel);
  const link = testLink();
  const { connection, worlds } = recordingConnection(channel, link);
  await until(() => link.state.opened);
  link.open();
  await until(() => connection.connected);
  link.deliver({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  await until(() => connection.client.welcomed);
  link.deliver({ kind: 'start', session: SANDBOX_SESSION, snapshotTick: null });
  await until(() => worlds.length === 1);
  const [world] = worlds;
  if (world === undefined) throw new Error('no world');

  const driver = relayedSessionDriver(world.session.driver, connection.client);
  connection.worldShown(world.worldId);
  for (let tick = 1; tick <= FRAMES; tick++) link.deliver({ kind: 'frame', tick, commands: [] });
  await until(() => {
    driver.advance(0);
    return world.session.host.tick >= FRAMES;
  });

  const file = await world.session.captureReplayFile({
    savedAt: 1721097600000,
    startedAt: 1721097500000,
    irVersion: 1,
    identity: { clientBuild: 'test-build', gameVersion: '9.9.9-test', contentFingerprint: 'content-x' },
  });
  expect(file.seed).toBe(SANDBOX_SESSION.seed);
  expect(file.untilTick).toBeGreaterThanOrEqual(FRAMES);
  const doc = parseReplayDocument(await decodeSaveText(file.bytes));
  expect(doc.kind).toBe(REPLAY_KIND);
  expect(doc.version).toBe(REPLAY_FORMAT_VERSION);
  expect(doc.fromTick).toBe(0);
  expect(doc.untilTick).toBe(file.untilTick);
  expect(doc.descriptor).toMatchObject({ world: { kind: 'scene', sceneId: 'sandbox' }, seed: 1 });

  world.session.dispose();
  connection.dispose();
  await until(() => link.state.closed);
});
