import type { RoomView } from '@open-northland/net-protocol';
import { expect, it, vi } from 'vitest';
import {
  createRoomMapTransfer,
  encodeMapTransfer,
  verifyMapDocuments,
} from '../../src/content/transfer/index.js';

const MAP = { width: 1, height: 1, typeIds: [0] };
const handle = verifyMapDocuments('island', MAP, null);
function room(): RoomView {
  return {
    id: 'room1',
    state: 'lobby',
    creator: 'Host',
    settings: {
      name: 'room',
      world: { kind: 'map', mapId: 'island' },
      seed: 1,
      rules: { fog: 1, progression: null, needs: false },
      speed: 1,
      mapOrigin: 'user',
    },
    seats: [],
    members: [
      {
        nick: 'Host',
        seat: 0,
        connected: true,
        compatibility: { content: 'content', map: handle.fingerprint, client: 'build', protocol: 2 },
      },
      {
        nick: 'Guest',
        seat: 1,
        connected: true,
        compatibility: { content: 'content', map: null, client: 'build', protocol: 2 },
      },
    ],
  };
}
function transport(local: boolean, kind = 'user'): typeof fetch {
  return async (input) => {
    const path = String(input);
    if (path === '/maps-index')
      return new Response(
        JSON.stringify(local ? [{ id: 'island', provenance: { kind, folder: 'UserMaps/island' } }] : []),
      );
    return local && path === '/maps/island.json'
      ? new Response(JSON.stringify(MAP))
      : new Response('', { status: 404 });
  };
}
function setup(local = false, nick = 'Guest', fetchImpl = transport(local)) {
  const client = { nick, sendBlob: vi.fn(), requestMap: vi.fn() };
  const onVerified = vi.fn();
  const onError = vi.fn();
  const transfer = createRoomMapTransfer({
    client,
    onVerified,
    onError,
    fetchImpl,
    cacheRead: async () => null,
    cacheWrite: async () => undefined,
  });
  return { client, onVerified, onError, transfer };
}
const blob = {
  kind: 'blob',
  type: 'map',
  from: 'Host',
  tick: null,
  bytes: encodeMapTransfer(handle, { kind: 'user' }),
} as const;

it('requests a missing user map and retains only creator-verified bytes', async () => {
  const s = setup();
  s.transfer.observe(room());
  await vi.waitFor(() => expect(s.client.requestMap).toHaveBeenCalledOnce());
  s.transfer.observeBlob({ ...blob, from: 'Other' });
  expect(s.transfer.verified()).toBeNull();
  expect(s.onError).toHaveBeenCalledOnce();
  s.transfer.observeBlob(blob);
  expect(s.transfer.verified()?.fingerprint).toBe(handle.fingerprint);
  await vi.waitFor(() => expect(s.onVerified).toHaveBeenLastCalledWith(s.transfer.verified()));
  s.transfer.observeBlob(blob);
  expect(s.onError).toHaveBeenCalledOnce();
  s.transfer.dispose();
});
it('never requests missing maps with unknown room origin and retries corrupt delivery', async () => {
  const blocked = setup();
  const forbidden = room();
  delete (forbidden.settings as { mapOrigin?: string }).mapOrigin;
  blocked.transfer.observe(forbidden);
  await vi.waitFor(() => expect(blocked.onVerified).toHaveBeenCalled());
  expect(blocked.client.requestMap).not.toHaveBeenCalled();
  blocked.transfer.dispose();
  const s = setup();
  s.transfer.observe(room());
  await vi.waitFor(() => expect(s.client.requestMap).toHaveBeenCalledOnce());
  s.transfer.observeBlob({ ...blob, bytes: 'bad' });
  expect(s.transfer.verified()).toBeNull();
  s.transfer.retry();
  await vi.waitFor(() => expect(s.client.requestMap).toHaveBeenCalledTimes(2));
  s.transfer.observeBlob(blob);
  expect(s.transfer.verified()).not.toBeNull();
  s.transfer.dispose();
});
it('creator sends retained local documents only when the local catalog permits delivery', async () => {
  const s = setup(true, 'Host');
  s.transfer.observe(room());
  await vi.waitFor(() => expect(s.onVerified).toHaveBeenCalled());
  s.transfer.observeBlob({ kind: 'mapRequest', from: 'Guest' });
  expect(s.client.sendBlob).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'map', to: 'Guest', tick: null }),
  );
  s.transfer.dispose();
  const denied = setup(true, 'Host', transport(true, 'unknown'));
  denied.transfer.observe(room());
  await vi.waitFor(() => expect(denied.onVerified).toHaveBeenCalled());
  denied.transfer.observeBlob({ kind: 'mapRequest', from: 'Guest' });
  expect(denied.client.sendBlob).not.toHaveBeenCalled();
  denied.transfer.dispose();
});
it('drops completion after leave or a new room even when fetch ignores abort', async () => {
  let release: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = transport(true);
  const fetchImpl: typeof fetch = async (input, init) => {
    await barrier;
    return original(input, init);
  };
  const s = setup(true, 'Guest', fetchImpl);
  s.transfer.observe(room());
  s.transfer.observe(null);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(s.onVerified).not.toHaveBeenCalled();
  expect(s.transfer.verified()).toBeNull();
  expect(s.onError).not.toHaveBeenCalled();
  s.transfer.dispose();
});

it('uses creation-time verified documents instead of reloading a changed local map', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input) === '/maps-index') return transport(true)(input);
    throw new Error('map documents must not be fetched again');
  };
  const s = setup(true, 'Host', fetchImpl);
  s.transfer.prepare(handle);
  s.transfer.observe(room());
  await vi.waitFor(() => expect(s.onVerified).toHaveBeenCalledWith(handle));
  s.transfer.retry();
  await vi.waitFor(() => expect(s.onVerified).toHaveBeenCalledTimes(2));
  expect(s.onError).not.toHaveBeenCalled();
  s.transfer.dispose();
});

it('vetoes delivery of a locally known unknown-origin map even when its id casing differs', async () => {
  const fetchImpl: typeof fetch = async (input) =>
    String(input) === '/maps-index'
      ? new Response(
          JSON.stringify([{ id: 'ISLAND', provenance: { kind: 'unknown', folder: 'Data/maps/island' } }]),
        )
      : new Response('', { status: 404 });
  const s = setup(false, 'Guest', fetchImpl);
  s.transfer.observe(room());
  await vi.waitFor(() => expect(s.onVerified).toHaveBeenCalledWith(null));
  expect(s.client.requestMap).not.toHaveBeenCalled();
  expect(s.onError).toHaveBeenCalled();
  s.transfer.dispose();
});

it('waits for persistence before readiness and drops late persistence completion after leave', async () => {
  let finish: () => void = () => undefined;
  const saved = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onVerified = vi.fn();
  const onError = vi.fn();
  const client = { nick: 'Guest', sendBlob: vi.fn(), requestMap: vi.fn() };
  const transfer = createRoomMapTransfer({
    client,
    onVerified,
    onError,
    fetchImpl: transport(false),
    cacheRead: async () => null,
    cacheWrite: async () => saved,
  });
  transfer.observe(room());
  await vi.waitFor(() => expect(client.requestMap).toHaveBeenCalled());
  transfer.observeBlob(blob);
  expect(onVerified).toHaveBeenLastCalledWith(null);
  transfer.observe(null);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onVerified).toHaveBeenCalledTimes(1);
  expect(transfer.verified()).toBeNull();
  transfer.dispose();
});

it('retrieves exact cached inputs in a running room without requesting another transfer', async () => {
  const onVerified = vi.fn();
  const client = { nick: 'Guest', sendBlob: vi.fn(), requestMap: vi.fn() };
  const active = { ...room(), state: 'running' as const };
  const cacheRead = vi.fn(async () => ({ handle, origin: 'user' as const }));
  const transfer = createRoomMapTransfer({
    client,
    onVerified,
    onError: vi.fn(),
    fetchImpl: transport(false),
    cacheRead,
  });
  transfer.observe(active);
  await vi.waitFor(() => expect(onVerified).toHaveBeenCalledWith(handle));
  expect(cacheRead).toHaveBeenCalledWith('island', { fingerprint: handle.fingerprint, origin: 'user' });
  expect(client.requestMap).not.toHaveBeenCalled();
  transfer.dispose();
});
