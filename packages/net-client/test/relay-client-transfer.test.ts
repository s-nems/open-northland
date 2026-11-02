import type { GameSession } from '@open-northland/lockstep';
import { RelayClient, type WorldPort } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD, PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';

const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 3,
  seats: [
    { player: 0, mode: 'human', color: 0 },
    { player: 1, mode: 'human', color: 1 },
  ],
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
const CACHED_TICK = 40;

function client(open: WorldPort['open'] = async () => null): RelayClient {
  const relayClient = new RelayClient({
    token: 'token-0123456789abcdef',
    nick: 'Ania',
    world: { open, restore: async () => null },
  });
  relayClient.attach(() => undefined);
  relayClient.receive({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  return relayClient;
}

function worldAt(tick: number): Simulation {
  const sim = new Simulation({ seed: 3, content: testContent() });
  sim.run(tick);
  return sim;
}

describe('RelayClient awaiting a large message', () => {
  it('awaits a requested map or initial save until it arrives or is refused', () => {
    const relayClient = client();
    expect(relayClient.awaitsTransfer).toBe(false);
    relayClient.requestMap();
    expect(relayClient.awaitsTransfer).toBe(true);
    relayClient.receive({ kind: 'blob', type: 'map', from: 'Bartek', tick: null, bytes: 'AAAA' });
    expect(relayClient.awaitsTransfer).toBe(false);
    relayClient.requestInitialSave();
    expect(relayClient.awaitsTransfer).toBe(true);
    relayClient.receive({
      kind: 'rejected',
      of: 'requestInitialSave',
      reason: { code: 'initialSaveMissing' },
    });
    expect(relayClient.awaitsTransfer).toBe(false);
  });

  it('awaits the map while the initial save asked for beside it is already answered', () => {
    const relayClient = client();
    relayClient.requestMap();
    relayClient.requestInitialSave();
    relayClient.receive({
      kind: 'rejected',
      of: 'requestInitialSave',
      reason: { code: 'initialSaveMissing' },
    });
    expect(relayClient.awaitsTransfer).toBe(true);
    relayClient.receive({ kind: 'blob', type: 'map', from: 'Bartek', tick: null, bytes: 'AAAA' });
    expect(relayClient.awaitsTransfer).toBe(false);
  });

  it('keeps awaiting a requested map when a repeat of the request is refused as too soon', () => {
    const relayClient = client();
    relayClient.requestMap();
    relayClient.requestMap();
    relayClient.receive({ kind: 'rejected', of: 'requestMap', reason: { code: 'retryTooSoon' } });
    expect(relayClient.awaitsTransfer).toBe(true);
    relayClient.receive({ kind: 'blob', type: 'map', from: 'Bartek', tick: null, bytes: 'AAAA' });
    expect(relayClient.awaitsTransfer).toBe(false);
    relayClient.requestMap();
    relayClient.receive({ kind: 'rejected', of: 'requestMap', reason: { code: 'retryTooSoon' } });
    expect(relayClient.awaitsTransfer).toBe(false);
  });

  it('awaits the snapshot a world it lacks is served, until the blob arrives', async () => {
    const relayClient = client();
    relayClient.receive({ kind: 'start', session: SESSION, snapshotTick: CACHED_TICK });
    await relayClient.settled();
    expect(relayClient.awaitsTransfer).toBe(true);
    relayClient.receive({ kind: 'blob', type: 'snapshot', from: 'Bartek', tick: CACHED_TICK, bytes: 'AAAA' });
    expect(relayClient.awaitsTransfer).toBe(false);
  });

  it('awaits a snapshot only while its world stands behind the cache', async () => {
    const behind = client(async () => ({ sim: worldAt(CACHED_TICK - 1), generation: DESCRIPTOR_WORLD }));
    behind.receive({ kind: 'start', session: SESSION, snapshotTick: CACHED_TICK });
    await behind.settled();
    expect(behind.awaitsTransfer).toBe(true);

    const level = client(async () => ({ sim: worldAt(CACHED_TICK), generation: CACHED_TICK }));
    level.receive({ kind: 'start', session: SESSION, snapshotTick: CACHED_TICK });
    await level.settled();
    expect(level.sim).not.toBeNull();
    expect(level.awaitsTransfer).toBe(false);
  });

  it('awaits the resync snapshot after a desync, and forgets every wait on a new socket', async () => {
    const relayClient = client(async () => ({ sim: worldAt(0), generation: DESCRIPTOR_WORLD }));
    relayClient.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    await relayClient.settled();
    expect(relayClient.awaitsTransfer).toBe(false);
    relayClient.receive({ kind: 'desync', tick: 1, domains: [], reference: 'Bartek' });
    expect(relayClient.awaitsTransfer).toBe(true);
    relayClient.requestMap();
    // The relay serves a new socket again from what it sends there.
    relayClient.hello();
    expect(relayClient.awaitsTransfer).toBe(false);
  });
});
