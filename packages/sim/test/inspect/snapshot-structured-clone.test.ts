import { describe, expect, it } from 'vitest';
import { defineComponent } from '../../src/ecs/world.js';
import {
  type Command,
  entityDeltas,
  Simulation,
  SnapshotMirror,
  type WorldSnapshot,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { expectSameWorld } from '../fixtures/snapshot-parity.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * Pins the snapshot's structured-cloneable claim (see `snapshot.ts` docstring; the "run the sim in a
 * Web Worker" Cross-cutting DX item). A `postMessage` boundary serializes via the structured clone
 * algorithm - a copy, not a zero-copy transfer - so the load-bearing test is: a REAL `step()`-driven
 * snapshot survives `structuredClone` (it would throw on a function / class instance / live `Map`),
 * comes back deep-equal (no data lost crossing the thread), and the copy is a genuine deep copy (a
 * worker owns its own, can't alias the sim's live state). This is the self-verifiable headless half -
 * the Worker wiring itself is app-side.
 */

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
const VIKING = 1;

/**
 * Drive a short real run that exercises the snapshot's non-trivial shapes: a building (a `Stockpile`
 * component is a `Map` → the clone turns it into a sorted `[k,v]` array) and a spawned settler. The
 * returned snapshot is taken after a completed `step()`, exactly as render/a worker would read it.
 */
function realRunSnapshot(): WorldSnapshot {
  const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(6, 1) });
  const schedule = new Map<number, Command[]>([
    [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
    [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
  ]);
  for (let tick = 1; tick <= 8; tick++) {
    for (const cmd of schedule.get(tick) ?? []) sim.enqueueSetup(cmd);
    sim.step();
  }
  return sim.snapshot();
}

describe('snapshot delta is structured-cloneable (Web-Worker boundary)', () => {
  it('a mirror fed with structured-cloned deltas rebuilds the live snapshot, owning its own copies', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(6, 1) });
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    let touchedAcrossRun = 0;
    let partialAcrossRun = 0;
    for (let tick = 1; tick <= 8; tick++) {
      for (const cmd of schedule.get(tick) ?? []) sim.enqueueSetup(cmd);
      sim.step();
      const delta = deltas.next();
      if (delta === null) throw new Error('a stepped tick must yield a delta');
      touchedAcrossRun += delta.touched.length;
      const cloned = structuredClone(delta);
      expect(cloned).toEqual(delta);
      expect(JSON.stringify(cloned)).toBe(JSON.stringify(delta));
      mirror.apply(cloned);
      for (const entry of entityDeltas(delta)) {
        const held = mirror.snapshot().entities.find((e) => e.id === entry.id);
        if (held === undefined) throw new Error(`touched entity ${entry.id} left the mirror`);
        if (Object.keys(entry.components).length < Object.keys(held.components).length) partialAcrossRun++;
      }
    }
    expect(touchedAcrossRun).toBeGreaterThan(0);
    expect(partialAcrossRun).toBeGreaterThan(0); // entries carrying part of their entity crossed too
    const live = sim.snapshot();
    const mirrored = mirror.snapshot();
    expectSameWorld(mirrored, live);
    // The mirror owns copies, as a worker's receiver would: no entity object is the sim's.
    for (const entity of mirrored.entities)
      expect(entity).not.toBe(live.entities.find((e) => e.id === entity.id));
  });
});

describe('snapshot is structured-cloneable (Web-Worker boundary)', () => {
  it('survives structuredClone - no functions / class instances / live Maps', () => {
    const snap = realRunSnapshot();
    // It must have real content, or the clone proves nothing.
    expect(snap.entities.length).toBeGreaterThan(0);
    // A live Map / class instance / function would throw DataCloneError here.
    expect(() => structuredClone(snap)).not.toThrow();
  });

  it('round-trips deep-equal - no data lost crossing the thread', () => {
    const snap = realRunSnapshot();
    const cloned = structuredClone(snap);
    // The transfer is lossless: the worker's view equals the sim's, field for field.
    expect(cloned).toEqual(snap);
    // And the canonical-JSON serialization (what the inspector/diff key on) is byte-identical.
    expect(JSON.stringify(cloned)).toBe(JSON.stringify(snap));
  });

  it('clones to a genuine deep copy - a worker can own it without aliasing live state', () => {
    const snap = realRunSnapshot();
    const cloned = structuredClone(snap);
    expect(cloned).not.toBe(snap);
    expect(cloned.entities).not.toBe(snap.entities);
    // Mutating the copy must not reach back into the original snapshot's nested data.
    const firstEntity = cloned.entities[0];
    const originalEntity = snap.entities[0];
    if (firstEntity === undefined || originalEntity === undefined)
      throw new Error('expected at least one entity');
    expect(firstEntity).not.toBe(originalEntity);
    (firstEntity.components as Record<string, unknown>).__injected = 'worker-side mutation';
    expect('__injected' in originalEntity.components).toBe(false);
  });

  /**
   * A `Set`-valued component would snapshot to `{}` and pass `structuredClone` above with its state simply
   * gone, so the clone rejects the shapes it cannot lower instead of emitting a lossy snapshot.
   */
  it('throws on a component shape it cannot lower to plain data', () => {
    const probe = defineComponent<unknown>('UncloneableProbe', 'economy');
    const withSet = new Simulation({ seed: 1, content: testContent() });
    withSet.world.add(withSet.world.create(), probe, { ids: new Set([1, 2]) });
    expect(() => withSet.snapshot()).toThrow(/uncloneable value shape Set/);

    const withFn = new Simulation({ seed: 1, content: testContent() });
    withFn.world.add(withFn.world.create(), probe, { onDone: () => undefined });
    expect(() => withFn.snapshot()).toThrow(/uncloneable value shape function/);
  });

  it("a building's Stockpile Map survived as a plain sorted [k,v] array (clone-safe form)", () => {
    const snap = realRunSnapshot();
    const building = snap.entities.find((e) => 'Stockpile' in e.components);
    if (building === undefined) throw new Error('expected a building with a Stockpile');
    const stock = (building.components.Stockpile as { amounts: unknown }).amounts;
    // takeSnapshot lowered the live Map to an array; that is precisely why structuredClone is safe.
    expect(Array.isArray(stock)).toBe(true);
    expect(() => structuredClone(stock)).not.toThrow();
  });
});
