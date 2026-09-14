import { contentFingerprint } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { FOG_MODE, Owner, Position, Signpost } from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import { defineComponent } from '../../src/ecs/world.js';
import {
  adminCommand,
  type ComponentSection,
  exportSaveGame,
  SAVE_FORMAT_VERSION,
  SAVE_KIND,
  SAVE_MAP_KEY,
  type SaveGame,
  type SaveGameSection,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { FOG_STATE } from '../../src/systems/vision/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

const P0 = 0;

function sectionIds(save: SaveGame): string[] {
  return save.sections.map((s) => s.id);
}

function componentSection(save: SaveGame, name: string): ComponentSection | undefined {
  for (const s of save.sections) {
    if (s.id === 'component' && s.name === name) return s;
  }
  return undefined;
}

function sectionOf<Id extends SaveGameSection['id']>(
  save: SaveGame,
  id: Id,
): Extract<SaveGameSection, { id: Id }> {
  const found = save.sections.find((s): s is Extract<SaveGameSection, { id: Id }> => s.id === id);
  if (found === undefined) throw new Error(`save has no ${id} section`);
  return found;
}

/** A mapped run with fog on, a standing fog eye, and a queued command - every section populated. */
function populatedSim(): Simulation {
  const sim = new Simulation({ seed: 7, content: testContent(), map: grassCellMap(8, 8) });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(4), y: fx.fromInt(4) });
  sim.world.add(e, Owner, { player: P0 });
  sim.world.add(e, Signpost, { links: [] });
  sim.run(12);
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

describe('exportSaveGame header', () => {
  it('records only caller-supplied creation time and refuses invalid timestamps', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(exportSaveGame(sim).header.savedAt).toBeNull();
    expect(exportSaveGame(sim, { savedAt: 1_800_000_000_000 }).header.savedAt).toBe(1_800_000_000_000);
    expect(exportSaveGame(sim, { savedAt: 0 }).header.savedAt).toBe(0);
    for (const savedAt of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
      expect(() => exportSaveGame(sim, { savedAt })).toThrow(/savedAt/);
    }
  });

  it('names the format, the content identity, the map, and the run position', () => {
    const content = testContent();
    const sim = new Simulation({ seed: 42, content, map: grassCellMap(4, 4) });
    sim.run(3);
    const save = exportSaveGame(sim, { mapId: 'campaign_01', entry: '?map=campaign_01&player=2' });
    expect(save.header).toEqual({
      kind: SAVE_KIND,
      formatVersion: SAVE_FORMAT_VERSION,
      irVersion: content.manifest.version,
      contentRevision: content.manifest.contentRevision,
      contentFingerprint: contentFingerprint(content),
      savedAt: null,
      mapId: 'campaign_01',
      mapFingerprint: sim.mapFingerprint,
      entry: '?map=campaign_01&player=2',
      session: null,
      seed: 42,
      tick: 3,
    });
  });

  it('records null provenance for a mapless scene sim', () => {
    const save = exportSaveGame(new Simulation({ seed: 1, content: testContent() }));
    expect(save.header.mapId).toBeNull();
    expect(save.header.mapFingerprint).toBeNull();
    expect(save.header.entry).toBeNull();
  });
});

describe('exportSaveGame sections', () => {
  it('an empty mapless world exports allocation, rng, and commands only', () => {
    const save = exportSaveGame(new Simulation({ seed: 1, content: testContent() }));
    expect(sectionIds(save)).toEqual(['entities', 'rng', 'commands']);
    expect(sectionOf(save, 'entities')).toEqual({ id: 'entities', nextId: 1, alive: [] });
    expect(sectionOf(save, 'commands')).toEqual({
      id: 'commands',
      nextSequence: 0,
      pending: [],
      continuation: [],
    });
  });

  it('preserves per-store insertion order after a remove and re-add', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const Tag = defineComponent<{ n: number }>('OrderProbe', 'economy');
    const [a, b, c] = [sim.world.create(), sim.world.create(), sim.world.create()];
    for (const e of [a, b, c]) sim.world.add(e, Tag, { n: e });
    sim.world.remove(b, Tag);
    sim.world.add(b, Tag, { n: b });
    const entries = componentSection(exportSaveGame(sim), 'OrderProbe')?.entries;
    expect(entries?.map(([id]) => id)).toEqual([a, c, b]);
  });

  it('keeps a registered store that emptied, because registration order is hashed state', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const Tag = defineComponent<{ n: number }>('EmptiedProbe', 'economy');
    const e = sim.world.create();
    sim.world.add(e, Tag, { n: 1 });
    sim.world.remove(e, Tag);
    expect(componentSection(exportSaveGame(sim), 'EmptiedProbe')).toEqual({
      id: 'component',
      name: 'EmptiedProbe',
      entries: [],
    });
  });

  it('serializes a Map component field as a $map wrapper keeping insertion order', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const Amounts = defineComponent<{ amounts: Map<number, number> }>('MapProbe', 'economy');
    const amounts = new Map<number, number>();
    for (const key of [3, 1, 2]) amounts.set(key, key * 10);
    sim.world.add(sim.world.create(), Amounts, { amounts });
    const entries = componentSection(exportSaveGame(sim), 'MapProbe')?.entries;
    expect(entries?.[0]?.[1]).toEqual({
      amounts: {
        [SAVE_MAP_KEY]: [
          [3, 30],
          [1, 10],
          [2, 20],
        ],
      },
    });
  });

  it('a rules carrier is absent until a command creates it, then present verbatim', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(componentSection(exportSaveGame(sim), 'WorldRules')).toBeUndefined();
    sim.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
    sim.step();
    const entries = componentSection(exportSaveGame(sim), 'WorldRules')?.entries;
    expect(entries?.map(([, value]) => value)).toEqual([{ needsEnabled: false }]);
  });

  it('exports fog masks as visibility digits with the cadence fields', () => {
    const sim = populatedSim();
    const save = exportSaveGame(sim);
    expect(componentSection(save, 'FogRules')?.entries).toHaveLength(1);
    const fogSection = sectionOf(save, 'fog');
    expect(fogSection.activeMode).toBe(FOG_MODE.RECON);
    expect(fogSection.lastRebuildTick).toBeGreaterThanOrEqual(0);
    const fog = sim.fog;
    if (fog === undefined) throw new Error('populated sim must have fog');
    const [firstMask] = fogSection.masks;
    expect(firstMask?.[0]).toBe(P0);
    expect(firstMask?.[1]).toHaveLength(fog.cellsWide * fog.cellsHigh);
    expect(firstMask?.[1]).toContain(String(FOG_STATE.VISIBLE));
    expect(firstMask?.[1]).toMatch(/^[0-2]+$/);
  });

  it('exports pending envelopes and the sequence position', () => {
    const sim = populatedSim();
    const commands = sectionOf(exportSaveGame(sim), 'commands');
    expect(commands.pending).toEqual([
      { v: 1, origin: 'setup', command: { kind: 'setNeedsEnabled', enabled: false } },
    ]);
    expect(commands.nextSequence).toBeGreaterThan(0);
  });
});

describe('exportSaveGame canonical bytes', () => {
  it('serializes the same state byte-identically, and parse re-serializes byte-identically', () => {
    const sim = populatedSim();
    const first = serializeSaveGame(exportSaveGame(sim, { mapId: 'm' }));
    expect(serializeSaveGame(exportSaveGame(sim, { mapId: 'm' }))).toBe(first);
    expect(serializeSaveGame(JSON.parse(first) as SaveGame)).toBe(first);
  });

  it('is a detached capture: an in-place mutation of a captured value does not reach the save', () => {
    const sim = populatedSim();
    const save = exportSaveGame(sim);
    const bytes = serializeSaveGame(save);
    const [eye] = [...sim.world.query(Position)];
    if (eye === undefined) throw new Error('populated sim must hold a positioned entity');
    sim.world.mut(eye, Position).x = fx.fromInt(1);
    sim.run(5);
    expect(serializeSaveGame(save)).toBe(bytes);
  });

  it('leaves the sim untouched: the state hash is identical before and after export', () => {
    const sim = populatedSim();
    const before = sim.hashState();
    exportSaveGame(sim);
    expect(sim.hashState()).toBe(before);
  });
});

describe('exportSaveGame rejection', () => {
  it('throws naming the component for a value shape JSON cannot carry', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), defineComponent<unknown>('SetProbe', 'economy'), { bag: new Set([1]) });
    expect(() => exportSaveGame(sim)).toThrow(/component:SetProbe\/1\.bag: unsaveable value shape Set/);
  });

  it('throws naming the path for a record using the reserved $map key', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), defineComponent<unknown>('ReservedProbe', 'economy'), {
      bag: { [SAVE_MAP_KEY]: [] },
    });
    expect(() => exportSaveGame(sim)).toThrow(/component:ReservedProbe\/1\.bag: the key '\$map' is reserved/);
  });

  it('throws naming both paths for a cyclic component value', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    sim.world.add(sim.world.create(), defineComponent<unknown>('CycleProbe', 'economy'), { bag: cyclic });
    expect(() => exportSaveGame(sim)).toThrow(
      /component:CycleProbe\/1\.bag\.self: object already saved at component:CycleProbe\/1\.bag/,
    );
  });

  it('throws naming both paths for an object shared between two entities', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const Probe = defineComponent<unknown>('AliasProbe', 'economy');
    const shared = { n: 1 };
    sim.world.add(sim.world.create(), Probe, { bag: shared });
    sim.world.add(sim.world.create(), Probe, { bag: shared });
    expect(() => exportSaveGame(sim)).toThrow(
      /component:AliasProbe\/2\.bag: object already saved at component:AliasProbe\/1\.bag/,
    );
  });

  it('throws naming the path for a non-finite number and for undefined', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), defineComponent<unknown>('NanProbe', 'economy'), { hp: Number.NaN });
    expect(() => exportSaveGame(sim)).toThrow(/component:NanProbe\/1\.hp: non-finite number/);
    const sim2 = new Simulation({ seed: 1, content: testContent() });
    sim2.world.add(sim2.world.create(), defineComponent<unknown>('HoleProbe', 'economy'), { gap: undefined });
    expect(() => exportSaveGame(sim2)).toThrow(
      /component:HoleProbe\/1\.gap: unsaveable value shape undefined/,
    );
  });
});
