import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Component } from '../../src/ecs/world.js';
import { type Command, Simulation, type TerrainMap, type WorldSnapshot } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Pins the snapshot's **"transferable for free"** claim (see `snapshot.ts` docstring; the
 * "run the sim in a Web Worker" Cross-cutting DX item). The plan requires the snapshot to be a
 * plain transferable structure so moving `step()` off the main thread is free, **not** a
 * serialization retrofit. The actual `postMessage` boundary serializes via the structured clone
 * algorithm, so the load-bearing test is: a REAL `step()`-driven snapshot survives `structuredClone`
 * (it would throw on a function / class instance / live `Map`), comes back deep-equal (no data lost
 * crossing the thread), and the copy is a genuine deep copy (a worker owns its own, can't alias the
 * sim's live state). This is the self-verifiable headless half — the Worker wiring itself is app-side.
 */

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
const VIKING = 1;
const GRASS = 0;

/** Clear every component store (shared singletons) so each run starts clean. */
function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as Component<unknown>).store.clear();
    }
  }
}

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

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
    for (const cmd of schedule.get(tick) ?? []) sim.enqueue(cmd);
    sim.step();
  }
  return sim.snapshot();
}

describe('snapshot is transferable (Web-Worker boundary)', () => {
  beforeEach(clearComponentStores);

  it('survives structuredClone — no functions / class instances / live Maps', () => {
    const snap = realRunSnapshot();
    // It must have real content, or the clone proves nothing.
    expect(snap.entities.length).toBeGreaterThan(0);
    // A live Map / class instance / function would throw DataCloneError here.
    expect(() => structuredClone(snap)).not.toThrow();
  });

  it('round-trips deep-equal — no data lost crossing the thread', () => {
    const snap = realRunSnapshot();
    const cloned = structuredClone(snap);
    // The transfer is lossless: the worker's view equals the sim's, field for field.
    expect(cloned).toEqual(snap);
    // And the canonical-JSON serialization (what the inspector/diff key on) is byte-identical.
    expect(JSON.stringify(cloned)).toBe(JSON.stringify(snap));
  });

  it('clones to a genuine deep copy — a worker can own it without aliasing live state', () => {
    const snap = realRunSnapshot();
    const cloned = structuredClone(snap);
    expect(cloned).not.toBe(snap);
    expect(cloned.entities).not.toBe(snap.entities);
    // Mutating the copy must not reach back into the original snapshot's nested data.
    const firstEntity = cloned.entities[0];
    if (firstEntity === undefined) throw new Error('expected at least one entity');
    expect(firstEntity).not.toBe(snap.entities[0]);
    (firstEntity.components as Record<string, unknown>).__injected = 'worker-side mutation';
    expect('__injected' in snap.entities[0].components).toBe(false);
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
