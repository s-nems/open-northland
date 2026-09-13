import { createSavedSessionMetadata } from '@open-northland/lockstep';
import { RelayClient } from '@open-northland/net-client';
import { type LobbyCompatibility, PROTOCOL_VERSION, type RoomView } from '@open-northland/net-protocol';
import { exportSaveGame, type SaveGame, Simulation } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { testContent } from '../../../sim/test/fixtures/content.js';
import type { RoomMapTransferOptions, VerifiedMapDocuments } from '../../src/content/transfer/index.js';
import { roomAssets } from '../../src/entries/main-menu/network/assets.js';

const IDENTITY = { fingerprint: 'c'.repeat(64), tick: 0 };
const MAP = { mapId: 'forest', fingerprint: 'b'.repeat(64) };
const REPORT: LobbyCompatibility = {
  content: 'a'.repeat(64),
  map: MAP.fingerprint,
  client: 'test',
  protocol: PROTOCOL_VERSION,
  save: null,
};
const SAVE = exportSaveGame(new Simulation({ seed: 1, content: testContent() }), { mapId: MAP.mapId });
const BLOB = { kind: 'blob', type: 'initialSave', from: 'Ania', tick: 0, bytes: 'AAAA' } as const;

function room(id = 'room'): RoomView {
  return {
    id,
    state: 'lobby',
    creator: 'Ania',
    settings: {
      name: 'Forest',
      world: { kind: 'map', mapId: MAP.mapId },
      seed: 1,
      rules: { fog: null, progression: null, needs: null },
      speed: 1,
      initialSave: IDENTITY,
    },
    seats: [{ player: 0, mode: 'human', color: 0, nick: 'Ania', ready: false }],
    members: [{ nick: 'Ania', seat: 0, connected: true, compatibility: null }],
  };
}
function deferredSave() {
  let resolve: (save: SaveGame) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<SaveGame>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function harness(verify = vi.fn(async () => SAVE)) {
  const client = new RelayClient({
    token: 'token-0123456789abcdef',
    nick: 'Ania',
    world: { open: async () => null, restore: async () => null },
  });
  const sent: unknown[] = [];
  client.attach((message) => sent.push(message));
  const failed = vi.fn();
  const load = vi.fn(async () => REPORT);
  const validate = vi.fn(async () => ({ fog: 0 as const, progression: true, needs: true }));
  let delivered: RoomMapTransferOptions['onVerified'] = () => undefined;
  const transfer = {
    prepare: vi.fn(),
    observe: vi.fn(),
    observeBlob: vi.fn(),
    retry: vi.fn(),
    verified: (): VerifiedMapDocuments | null => null,
    dispose: vi.fn(),
  };
  const changed = vi.fn();
  const assets = roomAssets(
    client,
    failed,
    {
      transfer: (options) => {
        delivered = options.onVerified;
        return transfer;
      },
      compatibility: load,
      verifySave: verify,
      validateSave: validate,
    },
    changed,
  );
  return {
    assets,
    changed,
    sent,
    failed,
    load,
    validate,
    transfer,
    deliver: (map: VerifiedMapDocuments | null) => delivered(map),
  };
}

describe('room assets coordinator', () => {
  it('verifies the pinned cached save after its original uploader leaves the room', async () => {
    const verify = vi.fn(async () => SAVE);
    const h = harness(verify);
    h.assets.observe({ ...room(), creator: 'New host' });
    h.deliver(MAP);
    h.assets.observeMessage(BLOB);
    await settle();
    expect(verify).toHaveBeenCalledWith(BLOB.bytes, IDENTITY, MAP.mapId);
    expect(h.assets.initialSave()?.identity).toEqual(IDENTITY);
  });

  it('validates duplicate initial-save deliveries only once and publishes the verified identity', async () => {
    const verification = deferredSave();
    const verify = vi.fn(() => verification.promise);
    const h = harness(verify);
    h.assets.observe(room());
    h.deliver(MAP);
    h.assets.observeMessage(BLOB);
    h.assets.observeMessage(BLOB);
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    verification.resolve(SAVE);
    await settle();
    expect(h.validate).toHaveBeenCalledTimes(1);
    expect(h.assets.initialSave()?.identity).toEqual(IDENTITY);
    expect(h.sent.at(-1)).toEqual({
      kind: 'setCompatibility',
      compatibility: { ...REPORT, save: IDENTITY.fingerprint },
    });
  });

  it('drops stale save verification errors after leave or disposal', async () => {
    for (const dispose of [false, true]) {
      const verification = deferredSave();
      const h = harness(vi.fn(() => verification.promise));
      h.assets.observe(room());
      h.deliver(MAP);
      h.assets.observeMessage(BLOB);
      if (dispose) h.assets.dispose();
      else h.assets.observe(null);
      verification.reject(new Error('old room failure'));
      await settle();
      expect(h.failed).not.toHaveBeenCalled();
      expect(h.validate).not.toHaveBeenCalled();
      expect(h.assets.initialSave()).toBeNull();
    }
  });

  it('invalidates verification on retry before starting the replacement attempt', async () => {
    const first = deferredSave();
    const verify = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(SAVE);
    const h = harness(verify);
    h.assets.observe(room());
    h.deliver(MAP);
    h.assets.observeMessage(BLOB);
    h.assets.retry();
    h.deliver(MAP);
    await settle();
    first.reject(new Error('superseded'));
    await settle();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(h.failed).not.toHaveBeenCalled();
    expect(h.validate).toHaveBeenCalledTimes(1);
    expect(h.assets.initialSave()?.identity).toEqual(IDENTITY);
  });

  it('exposes saved roster metadata only after verification and validation, then repaints', async () => {
    const descriptor = {
      world: { kind: 'map' as const, mapId: MAP.mapId },
      seed: 1,
      speed: 1,
      rules: { fog: null, progression: null, needs: null },
      seats: [{ player: 0, color: 0, mode: 'human' as const }],
      localSeat: 0,
    };
    const metadata = createSavedSessionMetadata(descriptor, [{ player: 0, nick: 'Ania' }]);
    const save = { ...SAVE, header: { ...SAVE.header, session: metadata } };
    const verification = deferredSave();
    const h = harness(vi.fn(() => verification.promise));
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    h.validate.mockImplementation(async () => {
      await pending;
      return { fog: 0 as const, progression: true, needs: true };
    });
    h.assets.observe(room());
    h.deliver(MAP);
    h.assets.observeMessage(BLOB);
    expect(h.assets.savedRoster()).toBeNull();
    verification.resolve(save);
    await settle();
    expect(h.assets.savedRoster()).toBeNull();
    expect(h.changed).not.toHaveBeenCalled();
    finish();
    await settle();
    expect(h.assets.savedRoster()).toEqual(metadata);
    expect(h.changed).toHaveBeenCalledOnce();
    h.assets.retry();
    expect(h.assets.savedRoster()).toBeNull();
    expect(h.changed).toHaveBeenCalledTimes(2);
  });

  it('does not expose roster hints when save validation fails', async () => {
    const h = harness();
    h.validate.mockRejectedValue(new Error('invalid saved world'));
    h.assets.observe(room());
    h.deliver(MAP);
    h.assets.observeMessage(BLOB);
    await settle();
    expect(h.assets.savedRoster()).toBeNull();
    expect(h.assets.initialSave()).toBeNull();
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('passes prepared and missing map handles directly instead of refetching documents', async () => {
    const h = harness();
    h.assets.prepare(null, MAP);
    expect(h.transfer.prepare).toHaveBeenCalledWith(MAP);
    h.assets.observe(room());
    h.deliver(null);
    await settle();
    expect(h.load).toHaveBeenCalledWith(MAP.mapId, null);
    h.deliver(MAP);
    await settle();
    expect(h.load).toHaveBeenLastCalledWith(MAP.mapId, MAP);
  });
});
