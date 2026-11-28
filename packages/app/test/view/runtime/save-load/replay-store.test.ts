import { beforeEach, describe, expect, it } from 'vitest';
import { compressSaveText, type SaveBytes } from '../../../../src/view/runtime/save-load/codec.js';
import {
  browserReplayStore,
  type ReplaySlotMeta,
} from '../../../../src/view/runtime/save-load/replay-store.js';
import { fakeIdbDatabase, installFakeIndexedDb, resetFakeIndexedDb } from '../../../support/fake-idb.js';

/**
 * The replay store keys a recording by its session and keeps the display name in the metadata, so a
 * session's later capture overwrites its own slot and a slot this build cannot read whole lists as
 * nothing rather than lying about what it holds.
 */

const DB_NAME = 'open-northland-replays';

function metaOf(name: string, overrides: Partial<ReplaySlotMeta> = {}): ReplaySlotMeta {
  return {
    name,
    mapId: 'magiczny_las',
    untilTick: 400,
    seed: 7,
    savedAt: 1764240000000,
    clientBuild: 'build-a',
    gameVersion: '0.1.0',
    ...overrides,
  };
}

async function bytesOf(text: string): Promise<SaveBytes> {
  return compressSaveText(text);
}

beforeEach(() => {
  installFakeIndexedDb();
  resetFakeIndexedDb();
});

describe('the replay store', () => {
  it('lists a written slot by its session key, name held apart from the id', async () => {
    const store = browserReplayStore();
    const bytes = await bytesOf('{"replay":"one"}');
    await store.write('1000-7', bytes, metaOf('magiczny_las · 2026-01-01 12:00:00'));
    const slots = await store.list();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.id).toBe('1000-7');
    expect(slots[0]?.name).toBe('magiczny_las · 2026-01-01 12:00:00');
    expect(slots[0]?.mapId).toBe('magiczny_las');
    expect(slots[0]?.seed).toBe(7);
    expect(slots[0]?.untilTick).toBe(400);
    expect(slots[0]?.clientBuild).toBe('build-a');
    expect(slots[0]?.gameVersion).toBe('0.1.0');
  });

  it('rewrites the same session key instead of adding a second slot, newest savedAt first', async () => {
    const store = browserReplayStore();
    await store.write('1000-7', await bytesOf('{"replay":"first"}'), metaOf('first', { savedAt: 1000 }));
    // The session plays on and its later capture lands: same key, longer recording, later moment.
    await store.write(
      '1000-7',
      await bytesOf('{"replay":"second"}'),
      metaOf('first', { savedAt: 2000, untilTick: 900 }),
    );
    await store.write(
      '2000-9',
      await bytesOf('{"replay":"other"}'),
      metaOf('other', { savedAt: 1500, seed: 9 }),
    );
    const slots = await store.list();
    expect(slots.map((slot) => slot.id)).toEqual(['1000-7', '2000-9']);
    expect(slots[0]?.untilTick).toBe(900);
    expect(await store.read('1000-7')).toEqual(await bytesOf('{"replay":"second"}'));
  });

  it('round-trips the bytes a read takes back out', async () => {
    const store = browserReplayStore();
    const bytes = await bytesOf('{"replay":"kept"}');
    await store.write('3000-1', bytes, metaOf('kept'));
    expect(await store.read('3000-1')).toEqual(bytes);
    expect(await store.read('missing')).toBeNull();
  });

  it('drops a slot whose metadata this build cannot read whole', async () => {
    const store = browserReplayStore();
    await store.write('4000-7', await bytesOf('{"replay":"kept"}'), metaOf('kept'));
    // A record of another shape sits beside the readable one: formats are replaced, never migrated,
    // so an unverifiable slot lists as nothing.
    const junk = fakeIdbDatabase(DB_NAME)?.get('meta');
    junk?.set('junk', { name: 'half-record', mapId: 'magiczny_las' });
    const slots = await store.list();
    expect(slots.map((slot) => slot.id)).toEqual(['4000-7']);
  });

  it('removes a slot from both its stores', async () => {
    const store = browserReplayStore();
    await store.write('5000-7', await bytesOf('{"replay":"gone"}'), metaOf('gone'));
    await store.remove('5000-7');
    expect(await store.list()).toEqual([]);
    expect(await store.read('5000-7')).toBeNull();
  });
});
