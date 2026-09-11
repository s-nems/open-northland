import { exportSaveGame, SAVE_FORMAT_VERSION, type Simulation, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { runDemoWorld } from '../src/game/world/index.js';
import { stagedSaveFrom } from '../src/view/runtime/save-load/boot.js';
import { decodeSaveText, isGzipSave, type SaveBytes } from '../src/view/runtime/save-load/codec.js';
import type { PickedSaveFile } from '../src/view/runtime/save-load/file-access.js';
import {
  evaluateSaveFile,
  type LiveWorldIdentity,
  saveLoadSession,
} from '../src/view/runtime/save-load/index.js';

/**
 * The in-game save and load flows against a live demo world: what a picked file must match before
 * the page may reload, and that a cancelled or rejected pick leaves the running session untouched.
 */

const WORLD_TOKEN = 'demo-test';

function demoSim(): Simulation {
  return runDemoWorld(7, 2);
}

function liveIdentity(sim: Simulation): LiveWorldIdentity {
  return {
    worldToken: WORLD_TOKEN,
    mapFingerprint: sim.mapFingerprint ?? null,
    irVersion: sim.content.manifest.version,
  };
}

function savedBytes(sim: Simulation, mapId: string = WORLD_TOKEN): string {
  return serializeSaveGame(exportSaveGame(sim, { mapId }));
}

/** A pick of an uncompressed save file, as a pre-gzip build would have written it. */
function pickedOf(text: string, name = 'a.json'): PickedSaveFile {
  return { name, contents: text, raw: new TextEncoder().encode(text) };
}

describe('evaluateSaveFile', () => {
  const sim = demoSim();
  const live = liveIdentity(sim);
  const bytes = savedBytes(sim);

  it('accepts a save of the running world, with or without a BOM', () => {
    expect(evaluateSaveFile(bytes, live)).toMatchObject({ ok: true });
    expect(evaluateSaveFile(`\uFEFF${bytes}`, live)).toMatchObject({ ok: true });
  });

  it('rejects unparseable text and JSON that is no save document', () => {
    expect(evaluateSaveFile('not json', live)).toEqual({ ok: false, reason: 'corrupt' });
    expect(evaluateSaveFile('{"foo":1}', live)).toEqual({ ok: false, reason: 'corrupt' });
    expect(evaluateSaveFile('{"header":{"kind":"elsewhere"}}', live)).toEqual({
      ok: false,
      reason: 'corrupt',
    });
  });

  it('reports a truncated real save as corrupt, not incompatible', () => {
    const doc = JSON.parse(bytes) as { sections: unknown };
    doc.sections = [];
    expect(evaluateSaveFile(JSON.stringify(doc), live)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('classifies a save from another format version as incompatible, older or newer', () => {
    for (const formatVersion of [SAVE_FORMAT_VERSION - 1, SAVE_FORMAT_VERSION + 1]) {
      const doc = JSON.parse(bytes) as { header: { formatVersion: number } };
      doc.header.formatVersion = formatVersion;
      expect(evaluateSaveFile(JSON.stringify(doc), live)).toEqual({
        ok: false,
        reason: 'incompatibleVersion',
      });
    }
  });

  it('rejects a save from another IR version, world or map', () => {
    expect(evaluateSaveFile(bytes, { ...live, irVersion: live.irVersion + 1 })).toEqual({
      ok: false,
      reason: 'wrongContent',
    });
    expect(evaluateSaveFile(bytes, { ...live, worldToken: 'another-map' })).toEqual({
      ok: false,
      reason: 'wrongWorld',
    });
    expect(evaluateSaveFile(bytes, { ...live, mapFingerprint: 'deadbeef' })).toEqual({
      ok: false,
      reason: 'wrongMap',
    });
  });
});

interface StoredSlot {
  readonly bytes: SaveBytes;
  readonly meta: { mapId: string | null; tick: number; entry: string | null };
}

interface Harness {
  readonly session: ReturnType<typeof saveLoadSession>;
  readonly store: Map<string, StoredSlot>;
  readonly staged: SaveBytes[];
  readonly reloads: () => number;
  readonly paused: () => boolean;
  readonly delivered: Array<{ fileName: string; bytes: SaveBytes }>;
}

const ENTRY_SEARCH = '?map=demo-test&player=2';

function harness(
  sim: Simulation,
  overrides: {
    pickFile?: () => Promise<PickedSaveFile | null>;
    stagePending?: (bytes: SaveBytes) => Promise<void>;
    deliverSave?: 'cancel' | 'throw';
    startPaused?: boolean;
    failWrite?: boolean;
  } = {},
): Harness {
  let paused = overrides.startPaused === true;
  let reloads = 0;
  const store = new Map<string, StoredSlot>();
  const staged: SaveBytes[] = [];
  const delivered: Array<{ fileName: string; bytes: SaveBytes }> = [];
  const session = saveLoadSession({
    sim,
    worldToken: WORLD_TOKEN,
    entrySearch: ENTRY_SEARCH,
    setPaused: (value) => {
      paused = value;
    },
    isPaused: () => paused,
    reload: () => {
      reloads++;
    },
    stagePending:
      overrides.stagePending ??
      ((bytes) => {
        staged.push(bytes);
        return Promise.resolve();
      }),
    pickFile: overrides.pickFile ?? (() => Promise.resolve(null)),
    deliverSave: (fileName, bytes) => {
      if (overrides.deliverSave === 'throw') return Promise.reject(new Error('disk full'));
      delivered.push({ fileName, bytes });
      return Promise.resolve({ kind: overrides.deliverSave === 'cancel' ? 'cancelled' : 'saved' });
    },
    store: {
      list: () =>
        Promise.resolve(
          [...store.entries()].map(([id, slot]) => ({
            id,
            name: id,
            mapId: slot.meta.mapId,
            tick: slot.meta.tick,
            entry: slot.meta.entry,
            savedAt: 0,
          })),
        ),
      read: (id) => Promise.resolve(store.get(id)?.bytes ?? null),
      write: (name, bytes, meta) => {
        if (overrides.failWrite === true) return Promise.reject(new Error('quota'));
        store.set(name, { bytes, meta });
        return Promise.resolve();
      },
      remove: (id) => {
        store.delete(id);
        return Promise.resolve();
      },
      showFolder: null,
    },
  });
  return { session, store, staged, reloads: () => reloads, paused: () => paused, delivered };
}

describe('stagedSaveFrom', () => {
  it('parses staged bytes through the same seam that accepted them, BOM included', () => {
    const sim = demoSim();
    const bytes = savedBytes(sim);
    expect(stagedSaveFrom(bytes, WORLD_TOKEN).header.tick).toBe(sim.tick);
    expect(stagedSaveFrom(`\uFEFF${bytes}`, WORLD_TOKEN).header.tick).toBe(sim.tick);
  });

  it('throws for a staged save naming another world', () => {
    const bytes = savedBytes(demoSim(), 'another-map');
    expect(() => stagedSaveFrom(bytes, WORLD_TOKEN)).toThrow(/names world "another-map"/);
  });
});

describe('saveLoadSession save flow', () => {
  it('writes the gzipped live sim into the named slot with its provenance', async () => {
    const sim = demoSim();
    const h = harness(sim);
    await expect(h.session.saveGame('Slot 1')).resolves.toEqual({ kind: 'saved' });
    const slot = h.store.get('Slot 1');
    expect(slot).toBeDefined();
    expect(isGzipSave(slot?.bytes ?? new Uint8Array())).toBe(true);
    const doc = JSON.parse(await decodeSaveText(slot?.bytes ?? new Uint8Array())) as {
      header: { mapId: string; tick: number; entry: string };
    };
    expect(doc.header.mapId).toBe(WORLD_TOKEN);
    expect(doc.header.entry).toBe(ENTRY_SEARCH);
    expect(doc.header.tick).toBe(sim.tick);
    expect(slot?.meta).toEqual({ mapId: WORLD_TOKEN, tick: sim.tick, entry: ENTRY_SEARCH });
    expect(h.paused()).toBe(false);
  });

  it('reports a failed store write and keeps the player pause state', async () => {
    const failed = harness(demoSim(), { failWrite: true, startPaused: true });
    await expect(failed.session.saveGame('Slot 1')).resolves.toEqual({ kind: 'failed' });
    expect(failed.paused()).toBe(true);
    expect(failed.store.size).toBe(0);
  });
});

describe('saveLoadSession slot load and export', () => {
  it('stages a stored slot byte-identically and reloads', async () => {
    const sim = demoSim();
    const h = harness(sim);
    await h.session.saveGame('Slot 1');
    await expect(h.session.loadSave('Slot 1')).resolves.toEqual({ kind: 'loading' });
    expect(h.staged).toEqual([h.store.get('Slot 1')?.bytes]);
    expect(h.reloads()).toBe(1);
  });

  it('rejects a vanished slot as missing, touching nothing', async () => {
    const h = harness(demoSim());
    await expect(h.session.loadSave('nope')).resolves.toEqual({ kind: 'rejected', reason: 'missing' });
    expect(h.staged).toEqual([]);
    expect(h.reloads()).toBe(0);
    expect(h.paused()).toBe(false);
  });

  it('exports a stored slot under a suffix honest about its gzip payload', async () => {
    const h = harness(demoSim());
    await h.session.saveGame('Slot 1');
    await h.session.saveGame('backup.json');
    await expect(h.session.exportSave('Slot 1')).resolves.toEqual({ kind: 'saved' });
    expect(h.delivered[0]?.fileName).toBe('Slot 1.json.gz');
    expect(h.delivered[0]?.bytes).toBe(h.store.get('Slot 1')?.bytes);
    // A slot the player named like a plain file still exports as the gzip it is.
    await expect(h.session.exportSave('backup.json')).resolves.toEqual({ kind: 'saved' });
    expect(h.delivered[1]?.fileName).toBe('backup.json.gz');
    await expect(h.session.exportSave('nope')).resolves.toEqual({ kind: 'failed' });
  });

  it('reports a cancelled export dialog and swallows a failed delivery', async () => {
    const cancelled = harness(demoSim(), { deliverSave: 'cancel' });
    await cancelled.session.saveGame('Slot 1');
    await expect(cancelled.session.exportSave('Slot 1')).resolves.toEqual({ kind: 'cancelled' });

    const failed = harness(demoSim(), { deliverSave: 'throw' });
    await failed.session.saveGame('Slot 1');
    await expect(failed.session.exportSave('Slot 1')).resolves.toEqual({ kind: 'failed' });
  });

  it('deletes a slot from the store', async () => {
    const h = harness(demoSim());
    await h.session.saveGame('Slot 1');
    await h.session.deleteSave('Slot 1');
    expect(h.store.size).toBe(0);
  });
});

describe('saveLoadSession panel pause', () => {
  it('forces the pause for an open panel and releases back to the player state', () => {
    const wasRunning = harness(demoSim());
    wasRunning.session.forcePause();
    expect(wasRunning.paused()).toBe(true);
    wasRunning.session.releaseForcedPause();
    expect(wasRunning.paused()).toBe(false);

    const wasPaused = harness(demoSim(), { startPaused: true });
    wasPaused.session.forcePause();
    wasPaused.session.releaseForcedPause();
    expect(wasPaused.paused()).toBe(true);
  });

  it('no flow touches the pause; the open panel owns it until the page dies', async () => {
    const sim = demoSim();
    const h = harness(sim, { pickFile: () => Promise.resolve(pickedOf(savedBytes(sim))) });
    h.session.forcePause();
    await expect(h.session.loadFromFile()).resolves.toEqual({ kind: 'loading' });
    expect(h.reloads()).toBe(1);
    expect(h.paused()).toBe(true);
  });
});

describe('saveLoadSession file load flow', () => {
  it('stages the picked file bytes and reloads', async () => {
    const sim = demoSim();
    const picked = pickedOf(savedBytes(sim));
    const h = harness(sim, { pickFile: () => Promise.resolve(picked) });
    await expect(h.session.loadFromFile()).resolves.toEqual({ kind: 'loading' });
    expect(h.staged).toEqual([picked.raw]);
    expect(h.reloads()).toBe(1);
  });

  it('keeps the session on a cancelled pick: nothing staged, no reload, pause untouched', async () => {
    const h = harness(demoSim(), { pickFile: () => Promise.resolve(null) });
    await expect(h.session.loadFromFile()).resolves.toEqual({ kind: 'cancelled' });
    expect(h.staged).toEqual([]);
    expect(h.reloads()).toBe(0);
    expect(h.paused()).toBe(false);
  });

  it('keeps the session on a rejected file and names the rejection', async () => {
    const sim = demoSim();
    const wrongWorld = savedBytes(sim, 'another-map');
    const h = harness(sim, {
      pickFile: () => Promise.resolve(pickedOf(wrongWorld)),
      startPaused: true,
    });
    await expect(h.session.loadFromFile()).resolves.toEqual({
      kind: 'rejected',
      reason: 'wrongWorld',
    });
    expect(h.staged).toEqual([]);
    expect(h.reloads()).toBe(0);
    expect(h.paused()).toBe(true);
  });

  it('treats an unreadable pick as corrupt and a failed staging as a storage rejection', async () => {
    const sim = demoSim();
    const unreadable = harness(sim, { pickFile: () => Promise.reject(new Error('io')) });
    await expect(unreadable.session.loadFromFile()).resolves.toEqual({
      kind: 'rejected',
      reason: 'corrupt',
    });

    const storage = harness(sim, {
      pickFile: () => Promise.resolve(pickedOf(savedBytes(sim))),
      stagePending: () => Promise.reject(new Error('quota')),
    });
    await expect(storage.session.loadFromFile()).resolves.toEqual({
      kind: 'rejected',
      reason: 'storage',
    });
    expect(storage.reloads()).toBe(0);
    expect(storage.paused()).toBe(false);
  });
});
