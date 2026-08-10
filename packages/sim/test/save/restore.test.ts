import { describe, expect, it } from 'vitest';
import { FOG_MODE } from '../../src/components/index.js';
import { defineComponent, type Entity } from '../../src/ecs/world.js';
import {
  adminCommand,
  type Command,
  exportSaveGame,
  parseSaveGame,
  Rng,
  restoreSimulation,
  SAVE_MAP_KEY,
  type SaveGame,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

const VIKING = 1;
const P0 = 0;
/** Job types the fixture models: idle, woodcutter, and the wide-vision scout. */
const JOB_TYPES = [0, 1, 27] as const;
const COW_TRIBE = 13;
const WOOD_GOOD = 1;
const MAP_CELLS = 12;
const NODE_RANGE = MAP_CELLS * 2;
const TARGET_ID_RANGE = 20;
/** Ticks before the save point, and continued ticks after it - the window crosses several
 *  VISION_CADENCE_TICKS rebuilds, so the restored cadence fields are load-bearing. */
const TICKS_BEFORE_SAVE = 80;
const TICKS_AFTER_SAVE = 23;

function pick<T>(rng: Rng, options: readonly T[]): T {
  const v = options[rng.int(options.length)];
  if (v === undefined) throw new Error('pick from empty options');
  return v;
}

/** One random command, a pure function of `gen` - movement keeps fog downgrade/stamp live, spawns
 *  keep the sim's own RNG stream drawing, kills retire entities mid-run. */
function nextCommand(gen: Rng): Command {
  const x = gen.int(NODE_RANGE);
  const y = gen.int(NODE_RANGE);
  switch (gen.int(4)) {
    case 0:
      return { kind: 'moveUnit', entity: (gen.int(TARGET_ID_RANGE) + 1) as Entity, x, y };
    case 1:
      return { kind: 'spawnSettler', jobType: pick(gen, JOB_TYPES), x, y, tribe: VIKING, owner: P0 };
    case 2:
      return { kind: 'dropGood', good: WOOD_GOOD, x, y, amount: gen.int(3) };
    default:
      return { kind: 'debugKill', target: (gen.int(TARGET_ID_RANGE) + 1) as Entity };
  }
}

function drive(sim: Simulation, gen: Rng, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    if (gen.int(3) === 0) sim.enqueueSetup(nextCommand(gen));
    sim.step();
  }
}

/** A mapped run under RECON fog with moving eyes, wildlife, a building, and loose goods. */
function scenario(): Simulation {
  const sim = new Simulation({ seed: 21, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: 27, x: 4, y: 4, tribe: VIKING, owner: P0 });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: 0, x: 8, y: 8, tribe: VIKING, owner: P0 });
  sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: COW_TRIBE, x: 16, y: 16, count: 3 });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: 1, x: 12, y: 12, tribe: VIKING, owner: P0 });
  sim.enqueueSetup({ kind: 'dropGood', good: WOOD_GOOD, x: 10, y: 10, amount: 5 });
  drive(sim, new Rng(0x5eed), TICKS_BEFORE_SAVE);
  return sim;
}

/** Export, serialize, JSON-parse, and validate - the full byte pipeline a real load goes through. */
function throughBytes(sim: Simulation, mapId?: string): { bytes: string; save: SaveGame } {
  const bytes = serializeSaveGame(exportSaveGame(sim, mapId === undefined ? {} : { mapId }));
  return { bytes, save: parseSaveGame(JSON.parse(bytes)) };
}

describe('restoreSimulation continuation', () => {
  it('continues byte-identically with the uninterrupted run through commands and fog rebuilds', () => {
    const original = scenario();
    original.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
    const { save } = throughBytes(original, 'campaign_01');
    const { sim: restored, contentRevisionDiffers } = restoreSimulation(save, {
      content: testContent(),
      map: grassCellMap(MAP_CELLS, MAP_CELLS),
    });
    expect(contentRevisionDiffers).toBe(false);
    expect(restored.tick).toBe(original.tick);
    expect(restored.rng.getState()).toBe(original.rng.getState());
    expect(restored.commands.pendingCount).toBe(1);
    expect(restored.hashState()).toBe(original.hashState());

    const genA = new Rng(0xab);
    const genB = new Rng(0xab);
    for (let n = 0; n < TICKS_AFTER_SAVE; n++) {
      if (genA.int(3) === 0) original.enqueueSetup(nextCommand(genA));
      if (genB.int(3) === 0) restored.enqueueSetup(nextCommand(genB));
      original.step();
      restored.step();
      expect(restored.hashState()).toBe(original.hashState());
      expect(restored.events.current()).toEqual(original.events.current());
    }
    // The saved pending envelope applied on schedule and sequence numbering never restarted.
    expect(restored.needsEnabled()).toBe(false);
    expect(original.needsEnabled()).toBe(false);
    expect(restored.commands.nextSequenceNumber).toBe(original.commands.nextSequenceNumber);
    expect(restored.commands.nextSequenceNumber).toBeGreaterThan(0);
    // Every incrementally-maintained cache (fog bounds, spatial indexes) rebuilt coherently.
    expect(restored.checkInvariants()).toEqual([]);
    // Byte-level equality closes hashState's Map-order blind spot: the hash key-sorts Map entries,
    // so only the exports can prove the two sims' Map insertion orders still agree.
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(serializeSaveGame(exportSaveGame(original)));
  });

  it('re-exports a freshly restored sim byte-identically to the original save', () => {
    const original = scenario();
    const { bytes, save } = throughBytes(original, 'campaign_01');
    const { sim: restored } = restoreSimulation(save, {
      content: testContent(),
      map: grassCellMap(MAP_CELLS, MAP_CELLS),
    });
    expect(serializeSaveGame(exportSaveGame(restored, { mapId: 'campaign_01' }))).toBe(bytes);
  });

  it('round-trips a negative rng stream position byte-identically', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    while (sim.rng.getState() >= 0) sim.rng.next();
    const { bytes, save } = throughBytes(sim);
    const { sim: restored } = restoreSimulation(save, { content: testContent() });
    expect(restored.rng.getState()).toBe(sim.rng.getState());
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(bytes);
  });

  it('restores per-store insertion order exactly, where an ascending-id rebuild would not', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const Tag = defineComponent<{ n: number }>('RestoreOrderProbe');
    const [a, b, c] = [sim.world.create(), sim.world.create(), sim.world.create()];
    for (const e of [a, b, c]) sim.world.add(e, Tag, { n: e });
    sim.world.remove(b, Tag);
    sim.world.add(b, Tag, { n: b });
    const { bytes, save } = throughBytes(sim);
    const { sim: restored } = restoreSimulation(save, { content: testContent() });
    expect([...restored.world.query(Tag)]).toEqual([a, c, b]);
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(bytes);
  });

  it('rebuilds a Map component field as a live Map in its saved insertion order', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const Amounts = defineComponent<{ amounts: Map<number, number> }>('RestoreMapProbe');
    const amounts = new Map<number, number>();
    for (const key of [3, 1, 2]) amounts.set(key, key * 10);
    const e = sim.world.create();
    sim.world.add(e, Amounts, { amounts });
    const { bytes, save } = throughBytes(sim);
    const { sim: restored } = restoreSimulation(save, { content: testContent() });
    const value = restored.world.get(e, Amounts);
    expect(value.amounts).toBeInstanceOf(Map);
    expect([...value.amounts.entries()]).toEqual([
      [3, 30],
      [1, 10],
      [2, 20],
    ]);
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(bytes);
  });
});

type Doc = { header: Record<string, unknown>; sections: Array<Record<string, unknown>> };

function docOf(sim: Simulation, mapId?: string): Doc {
  return JSON.parse(serializeSaveGame(exportSaveGame(sim, mapId === undefined ? {} : { mapId }))) as Doc;
}

function restoredFromDoc(doc: Doc, map?: 'mapped' | { cells: number }) {
  const content = testContent();
  if (map === undefined) return restoreSimulation(parseSaveGame(doc), { content });
  const cells = map === 'mapped' ? MAP_CELLS : map.cells;
  return restoreSimulation(parseSaveGame(doc), { content, map: grassCellMap(cells, cells) });
}

describe('restoreSimulation rejection', () => {
  it('rejects an IR version the loaded content does not speak', () => {
    const doc = docOf(new Simulation({ seed: 1, content: testContent() }));
    doc.header.irVersion = 999;
    expect(() => restoredFromDoc(doc)).toThrow(/save\.header\.irVersion: .*built on IR v999/);
  });

  it('rejects a map fingerprint mismatch, a missing map, and an unexpected map', () => {
    const mapped = docOf(new Simulation({ seed: 1, content: testContent(), map: grassCellMap(12, 12) }));
    expect(() => restoredFromDoc(mapped, { cells: 6 })).toThrow(/save\.header\.mapFingerprint/);
    expect(() => restoredFromDoc(mapped)).toThrow(/save\.header\.mapFingerprint/);
    const mapless = docOf(new Simulation({ seed: 1, content: testContent() }));
    expect(() => restoredFromDoc(mapless, 'mapped')).toThrow(/save\.header\.mapFingerprint/);
  });

  it('rejects an unknown component identifier by name', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), defineComponent<{ n: number }>('RenamedProbe'), { n: 1 });
    const doc = docOf(sim);
    const section = doc.sections.find((s) => s.id === 'component');
    if (section === undefined) throw new Error('exported save must hold the probe store');
    section.name = 'NoSuchComponent';
    expect(() => restoredFromDoc(doc)).toThrow(/unknown component 'NoSuchComponent'/);
  });

  it('rejects a malformed $map wrapper naming the entry path', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), defineComponent<{ m: Map<number, number> }>('MalformedMapProbe'), {
      m: new Map([[1, 2]]),
    });
    const doc = docOf(sim);
    const section = doc.sections.find((s) => s.id === 'component');
    if (section === undefined) throw new Error('exported save must hold the probe store');
    const entry = (section.entries as Array<[number, { m: unknown }]>)[0];
    if (entry === undefined) throw new Error('exported save must hold the probe entry');
    entry[1].m = { [SAVE_MAP_KEY]: 5 };
    expect(() => restoredFromDoc(doc)).toThrow(/component:MalformedMapProbe\/1\.m: malformed '\$map'/);
    entry[1].m = { [SAVE_MAP_KEY]: [], stray: 1 };
    expect(() => restoredFromDoc(doc)).toThrow(/component:MalformedMapProbe\/1\.m: malformed '\$map'/);
  });

  it('rejects a fog mask whose cell count does not match the map', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 0, x: 4, y: 4, tribe: VIKING, owner: P0 });
    sim.run(6);
    const doc = docOf(sim);
    const fog = doc.sections.find((s) => s.id === 'fog');
    if (fog === undefined) throw new Error('exported save must hold a fog section');
    const mask = (fog.masks as Array<[number, string]>)[0];
    if (mask === undefined) throw new Error('exported save must hold a fog mask');
    mask[1] = mask[1].slice(1);
    expect(() => restoredFromDoc(doc, 'mapped')).toThrow(/fog mask for player 0 holds/);
  });

  it('rejects an injected __proto__ key rather than restoring a value nothing can read', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.world.add(sim.world.create(), defineComponent<{ n: number }>('ProtoProbe'), { n: 1 });
    const doc = docOf(sim);
    const section = doc.sections.find((s) => s.id === 'component');
    if (section === undefined) throw new Error('exported save must hold the probe store');
    const entry = (section.entries as Array<[number, Record<string, unknown>]>)[0];
    if (entry === undefined) throw new Error('exported save must hold the probe entry');
    // Only a parsed document can carry this as an own key, so it is spliced into the JSON text.
    const text = JSON.stringify(doc).replace('{"n":1}', '{"n":1,"__proto__":{"x":9}}');
    expect(() => restoreSimulation(parseSaveGame(JSON.parse(text)), { content: testContent() })).toThrow(
      /component:ProtoProbe\/1: the key '__proto__'/,
    );
  });

  it('rejects a save whose restored state breaks the core invariants', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 0, x: 4, y: 4, tribe: VIKING, owner: P0 });
    sim.run(4);
    const doc = docOf(sim);
    const settlers = doc.sections.find((s) => s.id === 'component' && s.name === 'Settler');
    if (settlers === undefined) throw new Error('exported save must hold the settler store');
    const entry = (settlers.entries as Array<[number, Record<string, unknown>]>)[0];
    if (entry === undefined) throw new Error('exported save must hold a settler');
    entry[1] = { ...entry[1], hunger: -1 }; // past the needs clamp, which no live tick can produce
    expect(() => restoredFromDoc(doc, 'mapped')).toThrow(/violates the core invariants/);
  });

  it('reports a contentRevision difference instead of rejecting', () => {
    const original = new Simulation({ seed: 1, content: testContent() });
    original.run(3);
    const doc = docOf(original);
    doc.header.contentRevision = 7;
    const { sim: restored, contentRevisionDiffers } = restoredFromDoc(doc);
    expect(contentRevisionDiffers).toBe(true);
    expect(restored.tick).toBe(original.tick);
    expect(restored.hashState()).toBe(original.hashState());
  });
});
