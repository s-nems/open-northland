import { parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Component, Entity } from '../../src/ecs/world.js';
import {
  CORE_INVARIANTS,
  Simulation,
  type TerrainMap,
  checkInvariants,
  halfCellMapFromCells,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The `placeResource` command (and its shared {@link createResourceNode} assembly) at the COMPONENT
 * level — the fuzz proves determinism/replay, but not that the node is built with the right lifecycle
 * markers. This pins the three shapes a good resolves to (felled tree / mined deposit / pluck-whole
 * node), the non-obvious `MineDeposit.initial === remaining` invariant, and the id-neutral skip of a
 * good with no footprint record — so a regression like `initial: 0` or a both-markers stamp fails here.
 */

const { Felling, MineDeposit, Resource, ResourceFootprint } = components;

// The fixture's gathered goods + their harvest atomics (see test/fixtures/content.ts).
const WOOD = 1;
const STONE = 4;
const MUSHROOM = 5;
const WOOD_ATOM = 24;
const STONE_ATOM = 25;
const MUSHROOM_ATOM = 32;
// Fresh landscape logic-type ids + gfx indices for the footprint join (the base fixture has neither).
const LT_WOOD = 20;
const LT_STONE = 21;
const LT_MUSHROOM = 22;
const GFX_WOOD = 200;
const GFX_STONE = 201;
const GFX_MUSHROOM = 202;

/** The base test fixture plus a resource footprint (landscape logic type + gfx record + gathering join)
 *  for wood/stone/mushroom, so `placeResource` resolves a footprint and runs the create path. */
function footprintedContent() {
  const base = testContent();
  return parseContentSet({
    ...base,
    landscape: [
      ...base.landscape,
      { typeId: LT_WOOD, id: 'wood_node', walkable: true, buildable: true },
      { typeId: LT_STONE, id: 'stone_node', walkable: true, buildable: true },
      { typeId: LT_MUSHROOM, id: 'mushroom_node', walkable: true, buildable: true },
    ],
    landscapeGfx: [
      ...base.landscapeGfx,
      // [state, x, y, run] — one blocked cell at the node's own tile.
      {
        index: GFX_WOOD,
        logicType: LT_WOOD,
        maxValency: 3,
        isWorkable: true,
        walkBlockAreas: [[1, 0, 0, 1]],
      },
      {
        index: GFX_STONE,
        logicType: LT_STONE,
        maxValency: 5,
        isWorkable: true,
        walkBlockAreas: [[1, 0, 0, 1]],
      },
      {
        index: GFX_MUSHROOM,
        logicType: LT_MUSHROOM,
        maxValency: 1,
        isWorkable: true,
        workAreas: [[1, 0, 0, 1]],
      },
    ],
    gatheringPipeline: [
      ...base.gatheringPipeline,
      {
        goodType: WOOD,
        goodId: 'wood',
        harvestAtomic: WOOD_ATOM,
        bioLandscape: true,
        harvest: { landscapeType: LT_WOOD, gfxIndices: [GFX_WOOD] },
      },
      {
        goodType: STONE,
        goodId: 'stone',
        harvestAtomic: STONE_ATOM,
        bioLandscape: false,
        harvest: { landscapeType: LT_STONE, gfxIndices: [GFX_STONE] },
      },
      {
        goodType: MUSHROOM,
        goodId: 'mushroom',
        harvestAtomic: MUSHROOM_ATOM,
        bioLandscape: true,
        harvest: { landscapeType: LT_MUSHROOM, gfxIndices: [GFX_MUSHROOM] },
      },
    ],
  });
}

// A grass map of `width`×`height` CELLS — the sim navigates its 2×-resolution half-cell node lattice,
// so command/spec coords below are NODE coords (like every sim command).
function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(0) });
}

/** Clear every component store (module-level singletons) between sims. */
function clearStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) (c as Component<unknown>).store.clear();
  }
}

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: footprintedContent(), map: grassMap(12, 12) });
}

/** The first live resource node of a given good (there is only one per test). */
function nodeOf(sim: Simulation, good: number): Entity | null {
  for (const e of sim.world.query(Resource)) {
    if (sim.world.get(e, Resource).goodType === good) return e;
  }
  return null;
}

describe('placeResource command', () => {
  beforeEach(clearStores);

  it('stamps a felled tree for a fell good (Felling, no MineDeposit)', () => {
    const sim = newSim();
    sim.enqueue({
      kind: 'placeResource',
      good: WOOD,
      x: 3,
      y: 4,
      remaining: 4,
      harvestAtomic: WOOD_ATOM,
      felling: { chopsLeft: 3 },
    });
    sim.step();
    const e = nodeOf(sim, WOOD);
    expect(e).not.toBeNull();
    if (e === null) return;
    expect(sim.world.has(e, ResourceFootprint)).toBe(true);
    expect(sim.world.get(e, Resource).remaining).toBe(4);
    expect(sim.world.get(e, Felling).chopsLeft).toBe(3);
    expect(sim.world.has(e, MineDeposit)).toBe(false);
  });

  it('stamps a mined deposit for a mine good (MineDeposit.initial === remaining, no Felling)', () => {
    const sim = newSim();
    sim.enqueue({
      kind: 'placeResource',
      good: STONE,
      x: 2,
      y: 2,
      remaining: 5,
      harvestAtomic: STONE_ATOM,
      deposit: { levels: 5 },
    });
    sim.step();
    const e = nodeOf(sim, STONE);
    expect(e).not.toBeNull();
    if (e === null) return;
    const md = sim.world.get(e, MineDeposit);
    expect(md.initial).toBe(5); // initial seeds from `remaining` — the non-obvious invariant
    expect(md.levels).toBe(5);
    expect(sim.world.has(e, Felling)).toBe(false);
  });

  it('stamps a pluck-whole node for a pick good (neither Felling nor MineDeposit)', () => {
    const sim = newSim();
    sim.enqueue({
      kind: 'placeResource',
      good: MUSHROOM,
      x: 5,
      y: 5,
      remaining: 1,
      harvestAtomic: MUSHROOM_ATOM,
    });
    sim.step();
    const e = nodeOf(sim, MUSHROOM);
    expect(e).not.toBeNull();
    if (e === null) return;
    expect(sim.world.has(e, ResourceFootprint)).toBe(true);
    expect(sim.world.has(e, Felling)).toBe(false);
    expect(sim.world.has(e, MineDeposit)).toBe(false);
  });

  it('skips a good with no footprint record (no node created, id-neutral)', () => {
    const sim = newSim();
    const before = [...sim.world.query(Resource)].length;
    sim.enqueue({ kind: 'placeResource', good: 999, x: 1, y: 1, remaining: 3, harvestAtomic: WOOD_ATOM });
    sim.step();
    expect([...sim.world.query(Resource)].length).toBe(before);
  });

  it('is byte-identical from the same seed and holds the core invariants', () => {
    const runOnce = (): string => {
      clearStores();
      const sim = newSim();
      sim.enqueue({
        kind: 'placeResource',
        good: WOOD,
        x: 3,
        y: 4,
        remaining: 4,
        harvestAtomic: WOOD_ATOM,
        felling: { chopsLeft: 3 },
      });
      sim.enqueue({
        kind: 'placeResource',
        good: STONE,
        x: 7,
        y: 7,
        remaining: 5,
        harvestAtomic: STONE_ATOM,
        deposit: { levels: 5 },
      });
      for (let t = 0; t < 5; t++) sim.step();
      expect(checkInvariants(sim.world, CORE_INVARIANTS)).toEqual([]); // includes cachesCoherent
      return sim.hashState();
    };
    expect(runOnce()).toBe(runOnce());
  });
});
