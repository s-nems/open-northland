import { MessageChannel } from 'node:worker_threads';
import { PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { afterEach, it } from 'vitest';
import { patchStoredSettings } from '../../src/view/settings/store.js';
import { inProcessConnection, testLink, until } from '../support/net-worker/in-process-relay.js';

const channels: MessageChannel[] = [];
afterEach(() => {
  patchStoredSettings({ replayOptOut: false });
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

it('tells the relay the recording refusal as the stored setting changes, and joins with it', async () => {
  const channel = new MessageChannel();
  channels.push(channel);
  const link = testLink();
  const { connection } = inProcessConnection(channel, link);
  await until(() => link.state.opened);
  link.open();
  await until(() => connection.connected);
  link.deliver({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  await until(() => connection.client.welcomed);

  // The setting changed while this client sits connected: the room it sits in hears the new stand
  // without a re-entry, and a re-entry carries it of its own.
  patchStoredSettings({ replayOptOut: true });
  await until(() => link.sent.some((message) => message.kind === 'noReplay' && message.noReplay === true));
  connection.client.joinRoom('room-under-test', undefined, true);
  await until(() => link.sent.some((message) => message.kind === 'joinRoom' && message.noReplay === true));

  patchStoredSettings({ replayOptOut: false });
  await until(() => link.sent.some((message) => message.kind === 'noReplay' && message.noReplay === false));

  connection.dispose();
  await until(() => link.state.closed);
});
