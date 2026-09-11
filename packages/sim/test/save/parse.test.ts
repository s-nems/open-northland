import { describe, expect, it } from 'vitest';
import { FOG_MODE, Owner, Position, Signpost } from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import {
  exportSaveGame,
  parseSaveGame,
  SAVE_FORMAT_VERSION,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

const P0 = 0;
const SIGNPOST_RADIUS = 8;

type Doc = { header: Record<string, unknown>; sections: Array<Record<string, unknown>> };

/** A mapped run with fog, a standing eye, and a pending envelope - every section present. */
function populatedDoc(): Doc {
  const sim = new Simulation({ seed: 7, content: testContent(), map: grassCellMap(8, 8) });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(4), y: fx.fromInt(4) });
  sim.world.add(e, Owner, { player: P0 });
  sim.world.add(e, Signpost, { navRadius: SIGNPOST_RADIUS, spacingRadius: SIGNPOST_RADIUS });
  sim.run(6);
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return JSON.parse(serializeSaveGame(exportSaveGame(sim, { mapId: 'm' }))) as Doc;
}

function sectionOf(doc: Doc, id: string): Record<string, unknown> {
  const found = doc.sections.find((s) => s.id === id);
  if (found === undefined) throw new Error(`doc has no ${id} section`);
  return found;
}

describe('parseSaveGame acceptance', () => {
  it('rebuilds a decoded document canonically: re-serializing the parse reproduces the bytes', () => {
    const doc = populatedDoc();
    const bytes = JSON.stringify(doc);
    expect(serializeSaveGame(parseSaveGame(JSON.parse(bytes)))).toBe(bytes);
  });
});

describe('parseSaveGame header rejection', () => {
  it('rejects a non-object and a wrong kind', () => {
    expect(() => parseSaveGame([])).toThrow(/save: expected an object, got an array/);
    const doc = populatedDoc();
    doc.header.kind = 'zip-archive';
    expect(() => parseSaveGame(doc)).toThrow(/save\.header\.kind: expected 'open-northland-save'/);
  });

  it('rejects every format version but its own, older and newer alike', () => {
    for (const version of [SAVE_FORMAT_VERSION - 1, SAVE_FORMAT_VERSION + 1, 0, 1.5]) {
      const doc = populatedDoc();
      doc.header.formatVersion = version;
      expect(() => parseSaveGame(doc)).toThrow(
        `save.header.formatVersion: unsupported version ${version}, this build reads ${SAVE_FORMAT_VERSION}`,
      );
    }
  });

  it('rejects malformed provenance fields', () => {
    const doc = populatedDoc();
    doc.header.mapFingerprint = 12;
    expect(() => parseSaveGame(doc)).toThrow(/save\.header\.mapFingerprint: expected a string or null/);
    doc.header.mapFingerprint = null;
    doc.header.entry = 12;
    expect(() => parseSaveGame(doc)).toThrow(/save\.header\.entry: expected a string or null/);
    doc.header.entry = null;
    doc.header.tick = -1;
    expect(() => parseSaveGame(doc)).toThrow(/save\.header\.tick: expected a non-negative integer/);
  });
});

describe('parseSaveGame section-order rejection', () => {
  it('rejects a document that does not open with the entities section', () => {
    const doc = populatedDoc();
    doc.sections.shift();
    expect(() => parseSaveGame(doc)).toThrow(
      /save\.sections\[0\]: expected the 'entities' section, got "component"/,
    );
  });

  it('rejects a duplicated singleton section', () => {
    const doc = populatedDoc();
    doc.sections.push({ ...sectionOf(doc, 'rng') });
    expect(() => parseSaveGame(doc)).toThrow(/unexpected section after 'commands', got "rng"/);
    const doc2 = populatedDoc();
    const rngAt = doc2.sections.findIndex((s) => s.id === 'rng');
    doc2.sections.splice(rngAt, 0, { ...sectionOf(doc2, 'rng') });
    expect(() => parseSaveGame(doc2)).toThrow(/expected the 'fog' section|expected the 'commands' section/);
  });

  it('rejects an unknown section identifier', () => {
    const doc = populatedDoc();
    const rngAt = doc.sections.findIndex((s) => s.id === 'rng');
    doc.sections.splice(rngAt, 0, { id: 'wibble' });
    expect(() => parseSaveGame(doc)).toThrow(/expected the 'rng' section, got "wibble"/);
  });

  it('rejects a fog section in a mapless save', () => {
    const doc = populatedDoc();
    doc.header.mapFingerprint = null;
    expect(() => parseSaveGame(doc)).toThrow(/a mapless save cannot carry a fog section/);
  });

  it('requires the fog section for a mapped save', () => {
    const doc = populatedDoc();
    const at = doc.sections.findIndex((s) => s.id === 'fog');
    doc.sections.splice(at, 1);
    expect(() => parseSaveGame(doc)).toThrow(/expected the 'fog' section, got "commands"/);
  });
});

describe('parseSaveGame allocation rejection', () => {
  it('rejects alive ids out of order or never allocated', () => {
    const doc = populatedDoc();
    const entities = sectionOf(doc, 'entities');
    const alive = entities.alive as number[];
    expect(alive.length).toBeGreaterThan(1); // the eye plus the FogRules carrier
    entities.alive = [...alive].reverse();
    expect(() => parseSaveGame(doc)).toThrow(/does not ascend past/);
    entities.alive = [entities.nextId as number];
    expect(() => parseSaveGame(doc)).toThrow(/was never allocated/);
  });

  it('rejects a component entry for a dead entity and a duplicated entry', () => {
    const doc = populatedDoc();
    const section = sectionOf(doc, 'component');
    const entries = section.entries as Array<[number, unknown]>;
    const first = entries[0];
    if (first === undefined) throw new Error('populated doc must hold a component entry');
    entries.push([9999, first[1]]);
    expect(() => parseSaveGame(doc)).toThrow(/entity 9999 is not alive/);
    entries[entries.length - 1] = [first[0], first[1]];
    expect(() => parseSaveGame(doc)).toThrow(new RegExp(`duplicate entry for entity ${first[0]}`));
  });

  it('rejects a duplicate component section by name', () => {
    const doc = populatedDoc();
    const at = doc.sections.findIndex((s) => s.id === 'component');
    doc.sections.splice(at, 0, { ...sectionOf(doc, 'component'), entries: [] });
    expect(() => parseSaveGame(doc)).toThrow(/duplicate component section/);
  });

  it('rejects a nextId past the allocation ceiling, where ids would stop being distinct', () => {
    const doc = populatedDoc();
    sectionOf(doc, 'entities').nextId = Number.MAX_SAFE_INTEGER;
    expect(() => parseSaveGame(doc)).toThrow(/allocation ceiling/);
  });
});

describe('parseSaveGame rng, fog, and command rejection', () => {
  it('rejects an rng state outside the 32-bit stream domain', () => {
    const doc = populatedDoc();
    sectionOf(doc, 'rng').state = 2 ** 32;
    expect(() => parseSaveGame(doc)).toThrow(/state: 4294967296 is outside the 32-bit stream domain/);
  });

  it('rejects a mask with a character outside the FOG_STATE digits', () => {
    const doc = populatedDoc();
    const fog = sectionOf(doc, 'fog');
    const masks = fog.masks as Array<[number, string]>;
    const mask = masks[0];
    if (mask === undefined) throw new Error('populated doc must hold a fog mask');
    mask[1] = `x${mask[1].slice(1)}`;
    expect(() => parseSaveGame(doc)).toThrow(/masks\[0\]\[1\]: a mask is a non-empty string of FOG_STATE/);
  });

  it('rejects an unknown fog mode and mask players out of order', () => {
    const doc = populatedDoc();
    const fog = sectionOf(doc, 'fog');
    fog.activeMode = 9;
    expect(() => parseSaveGame(doc)).toThrow(/activeMode: unknown fog mode 9/);
    fog.activeMode = FOG_MODE.RECON;
    const masks = fog.masks as Array<[number, string]>;
    const mask = masks[0];
    if (mask === undefined) throw new Error('populated doc must hold a fog mask');
    masks.push([mask[0], mask[1]]);
    expect(() => parseSaveGame(doc)).toThrow(/masks\[1\]\[0\]: player 0 does not ascend past 0/);
  });

  it('rejects a malformed pending envelope naming its position', () => {
    const doc = populatedDoc();
    const commands = sectionOf(doc, 'commands');
    (commands.pending as unknown[]).push({ v: 1, origin: 'nobody', command: { kind: 'setNeedsEnabled' } });
    expect(() => parseSaveGame(doc)).toThrow(/pending\[1\]: unknown origin "nobody"/);
    commands.pending = [];
    commands.nextSequence = -1;
    expect(() => parseSaveGame(doc)).toThrow(/nextSequence: expected a non-negative integer/);
  });
});
