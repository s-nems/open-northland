import type { TerrainMap } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { GRASS } from '../src/catalog/buildings.js';
import { TERRAIN_IMPASSABLE } from '../src/catalog/terrain.js';
import { runAuthoredSlice, runBareMap, runSlice, sliceTerrain } from '../src/slice/vertical-slice.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from './support/authored-entities.js';
import { authoredMap, mixedGrid } from './support/slice-maps.js';

/**
 * The demo scenario the live + shot entries share: the terrain projection and the three sims built over
 * it — the demo slice, a bare imported map, and a map's authored entities.
 */

describe('sliceTerrain', () => {
  it('projects an injected map, else the synthetic grass strip', () => {
    // Default (no map) = the reproducible 6×1 grass strip the shot PNG + golden depend on.
    const fallback = sliceTerrain();
    expect(fallback.width).toBe(6);
    expect(fallback.height).toBe(1);
    expect(fallback.typeIds).toEqual(new Array(6).fill(GRASS));

    // An injected (loaded) map drives the terrain instead.
    const loaded = sliceTerrain({ width: 2, height: 1, typeIds: [4, 9] });
    expect(loaded).toEqual({ width: 2, height: 1, typeIds: [4, 9] });
  });
});

describe('runSlice on a loaded map', () => {
  it('builds + steps the sim over the real grid without a content gap', () => {
    // The plain strip uses only the grass class; this grid uses {5,16,22}. If the global sandbox content did
    // not fold those in, buildTerrainGraph would throw "landscape typeId N absent from content".
    const sim = runSlice(7, 30, mixedGrid(4, 8));
    expect(sim.terrain?.width).toBe(4);
    expect(sim.terrain?.height).toBe(8);
    expect(sim.terrain?.nodeCount).toBe(32);
  });

  it('places the slice entities on the first walkable cells of the grid, not the strip', () => {
    const { Position, Building, Settler, Resource, DeliveryFlag } = components;
    // ticks=1 so the placeBuilding/spawnSettler commands (applied on tick 1) have run — the two wood
    // nodes are created directly, but the command entities only exist after the first step.
    const sim = runSlice(7, 1, mixedGrid(4, 8));

    // Seven positioned entities: HQ + sawmill (Building), woodcutter + carrier (Settler), two wood nodes
    // (Resource), and the woodcutter's WORK FLAG (a Position + DeliveryFlag, auto-planted at its feet on
    // spawn — a gatherer is never free). The grid leaves enough open ground beyond the building bodies for
    // the flag's free-field placement; at least one entity must sit below the synthetic strip's row-0 line.
    const positioned = [...sim.world.query(Position)].map((e) => sim.world.get(e, Position));
    expect(positioned).toHaveLength(7);
    const onRealRows = positioned.some((p) => p.y > 0);
    expect(onRealRows).toBe(true);
    // Each kind is present, including the gatherer's auto-planted flag.
    expect([...sim.world.query(Building)]).toHaveLength(2);
    expect([...sim.world.query(Settler)]).toHaveLength(2);
    expect([...sim.world.query(Resource)]).toHaveLength(2);
    expect([...sim.world.query(DeliveryFlag)]).toHaveLength(1);
  });

  it('is deterministic over the loaded map (same seed+map ⇒ same hash)', () => {
    const a = runSlice(7, 60, mixedGrid(4, 8)).hashState();
    const b = runSlice(7, 60, mixedGrid(4, 8)).hashState();
    expect(a).toBe(b);
  });

  it('falls back to the synthetic strip when a loaded map has too few walkable cells', () => {
    // TERRAIN_IMPASSABLE is the demo's non-walkable water class; an all-impassable grid has 0 walkable
    // cells, so placement can't fit the slice — runSlice must degrade to the 6×1 strip rather than throw.
    const allWater: TerrainMap = {
      resolution: 'half-cell',
      width: 3,
      height: 3,
      typeIds: new Array(9).fill(TERRAIN_IMPASSABLE),
    };
    expect(() => runSlice(7, 1, allWater)).not.toThrow();
    const fallback = runSlice(7, 1, allWater).hashState();
    const strip = runSlice(7, 1).hashState();
    // Falling back means the sim is byte-identical to the no-map slice (same content, terrain, cells).
    expect(fallback).toBe(strip);
  });
});

describe('runBareMap (imported map with no authored entities)', () => {
  it('builds a navigable sim over the real grid but places NO demo entities', () => {
    const { Position, Building, Settler } = components;
    // The `?map=` viewer's default for a plain imported map: the map's own trees/ore spawn separately
    // (spawnMapResources, in the entry), so the bare sim itself must carry NONE of the synthetic
    // HQ/joinery/gatherer/carrier demo cluster that used to land on every map's top-left.
    const sim = runBareMap(7, mixedGrid(4, 3));
    expect(sim.terrain?.nodeCount).toBe(12);
    expect([...sim.world.query(Position)]).toHaveLength(0);
    expect([...sim.world.query(Building)]).toHaveLength(0);
    expect([...sim.world.query(Settler)]).toHaveLength(0);
  });

  it('is deterministic over the loaded map (same seed+map ⇒ same hash)', () => {
    const a = runBareMap(7, mixedGrid(4, 3)).hashState();
    const b = runBareMap(7, mixedGrid(4, 3)).hashState();
    expect(a).toBe(b);
  });
});

describe('runAuthoredSlice (map.cif StaticObjects → sim commands)', () => {
  it('places the resolved buildings + settlers at their authored nodes', () => {
    const { Position, Building, Settler } = components;
    // ticks=1: placeBuilding/spawnSettler commands apply on the first step.
    const sim = runAuthoredSlice(7, 1, authoredMap(), AUTHORED_ENTITIES, AUTHORED_ROWS);
    expect(sim).not.toBeNull();
    if (sim === null) throw new Error('expected an authored sim');

    // Positions truncated to whole CELLS: node (8,4) is cell (4,2)'s row-2 line, node (3,5) sits at
    // fractional (1.25, 2.5) → cell (1,2) — the authored anchors, on the map, at half-cell precision.
    const cellsOf = (comp: typeof Building | typeof Settler): string[] =>
      [...sim.world.query(comp)]
        .map((e) => sim.world.get(e, Position))
        .map((p) => `${Math.trunc(p.x / 65536)},${Math.trunc(p.y / 65536)}`)
        .sort();
    expect(cellsOf(Building)).toEqual(['0,0', '4,2']);
    expect(cellsOf(Settler)).toEqual(['1,2']);

    // The authored addgoods stock landed on the RIGHT building: the goods-bearing barracks (typeId 30)
    // holds 15 wheat (good typeId 4); the other placement stays empty.
    const { Stockpile } = components;
    const stocked = [...sim.world.query(Building)]
      .map((e) => [sim.world.get(e, Building).buildingType, sim.world.get(e, Stockpile).amounts.get(4)])
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    expect(stocked).toEqual([
      [30, 15],
      [31, undefined],
    ]);
  });

  it('returns null when nothing resolves (caller falls back to the demo slice)', () => {
    const unresolvable = {
      buildings: [{ name: 'unknown house', level: 0, player: 1, hx: 2, hy: 2 }],
      humans: [],
      animals: [],
    };
    expect(runAuthoredSlice(7, 1, authoredMap(), unresolvable, AUTHORED_ROWS)).toBeNull();
  });

  it('is deterministic (same seed + same authored entities ⇒ same hash)', () => {
    const a = runAuthoredSlice(7, 40, authoredMap(), AUTHORED_ENTITIES, AUTHORED_ROWS)?.hashState();
    const b = runAuthoredSlice(7, 40, authoredMap(), AUTHORED_ENTITIES, AUTHORED_ROWS)?.hashState();
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });
});
