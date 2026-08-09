import { exportSaveGame, SAVE_FORMAT_VERSION, type Simulation, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { runDemoWorld } from '../src/game/world/index.js';
import { stagedSaveFrom } from '../src/view/runtime/save-load/boot.js';
import { decodeSaveText, isGzipSave, type SaveBytes } from '../src/view/runtime/save-load/codec.js';
import {
  evaluateSaveFile,
  type LiveWorldIdentity,
  type PickedSaveFile,
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

  it('classifies an unmigratable format version as incompatible', () => {
    const doc = JSON.parse(bytes) as { header: { formatVersion: number } };
    doc.header.formatVersion = SAVE_FORMAT_VERSION + 1;
    expect(evaluateSaveFile(JSON.stringify(doc), live)).toEqual({
      ok: false,
      reason: 'incompatibleVersion',
    });
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

interface Harness {
  readonly session: ReturnType<typeof saveLoadSession>;
  readonly staged: SaveBytes[];
  readonly reloads: () => number;
  readonly paused: () => boolean;
  readonly delivered: Array<{ fileName: string; bytes: SaveBytes }>;
}

function harness(
  sim: Simulation,
  overrides: {
    pickFile?: () => Promise<PickedSaveFile | null>;
    stagePending?: (bytes: SaveBytes) => Promise<void>;
    deliverSave?: 'cancel' | 'throw';
    startPaused?: boolean;
  } = {},
): Harness {
  let paused = overrides.startPaused === true;
  let reloads = 0;
  const staged: SaveBytes[] = [];
  const delivered: Array<{ fileName: string; bytes: SaveBytes }> = [];
  const session = saveLoadSession({
    sim,
    worldToken: WORLD_TOKEN,
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
  });
  return { session, staged, reloads: () => reloads, paused: () => paused, delivered };
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
  it('delivers the gzipped live sim under the world token and reports saved', async () => {
    const sim = demoSim();
    const h = harness(sim);
    await expect(h.session.saveGame()).resolves.toEqual({ kind: 'saved' });
    expect(h.delivered).toHaveLength(1);
    const bytes = h.delivered[0]?.bytes ?? new Uint8Array();
    expect(isGzipSave(bytes)).toBe(true);
    const doc = JSON.parse(await decodeSaveText(bytes)) as {
      header: { mapId: string; tick: number };
    };
    expect(doc.header.mapId).toBe(WORLD_TOKEN);
    expect(doc.header.tick).toBe(sim.tick);
    expect(h.delivered[0]?.fileName).toMatch(/^open-northland-demo-test-tick2-.*\.json\.gz$/);
    expect(h.paused()).toBe(false);
  });

  it('reports a cancelled dialog and a failed write without unpausing the player', async () => {
    const cancelled = harness(demoSim(), { deliverSave: 'cancel', startPaused: true });
    await expect(cancelled.session.saveGame()).resolves.toEqual({ kind: 'cancelled' });
    expect(cancelled.paused()).toBe(true);

    const failed = harness(demoSim(), { deliverSave: 'throw' });
    await expect(failed.session.saveGame()).resolves.toEqual({ kind: 'failed' });
    expect(failed.paused()).toBe(false);
  });
});

describe('saveLoadSession load flow', () => {
  it('stages the picked file bytes and reloads, still paused for the dying page', async () => {
    const sim = demoSim();
    const picked = pickedOf(savedBytes(sim));
    const h = harness(sim, { pickFile: () => Promise.resolve(picked) });
    await expect(h.session.loadGame()).resolves.toEqual({ kind: 'loading' });
    expect(h.staged).toEqual([picked.raw]);
    expect(h.reloads()).toBe(1);
    expect(h.paused()).toBe(true);
  });

  it('keeps the session on a cancelled pick: nothing staged, no reload, pause state restored', async () => {
    const h = harness(demoSim(), { pickFile: () => Promise.resolve(null) });
    await expect(h.session.loadGame()).resolves.toEqual({ kind: 'cancelled' });
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
    await expect(h.session.loadGame()).resolves.toEqual({
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
    await expect(unreadable.session.loadGame()).resolves.toEqual({
      kind: 'rejected',
      reason: 'corrupt',
    });

    const storage = harness(sim, {
      pickFile: () => Promise.resolve(pickedOf(savedBytes(sim))),
      stagePending: () => Promise.reject(new Error('quota')),
    });
    await expect(storage.session.loadGame()).resolves.toEqual({
      kind: 'rejected',
      reason: 'storage',
    });
    expect(storage.reloads()).toBe(0);
    expect(storage.paused()).toBe(false);
  });
});
