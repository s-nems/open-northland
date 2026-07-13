import { buildScene, terrainMapToScene } from '@vinland/render';
import type { TerrainMap } from '@vinland/sim';
import { components, halfCellMapFromCells } from '@vinland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthoredJoinRows, resolveAuthoredPlacements } from '../src/slice/authored-placements.js';
import { loadTerrainMap } from '../src/slice/map-loader.js';
import { runAuthoredSlice, runBareMap, runSlice, sliceTerrain } from '../src/slice/vertical-slice.js';
import { EMPTY_SNAPSHOT } from './support/snapshot.js';
import { clearStores } from './support/stores.js';

/**
 * Unit tests for the app's map-loading seam — the testable core of "the shot/dev entry draws an
 * actual `content/maps/<id>.json`". The browser `fetch` + GPU pixels can't run headless, but the
 * load-bearing logic (validate the fetched JSON through `@vinland/data`'s `parseTerrainMap`, then
 * project it through `terrainMapToScene`, with graceful fallback on a bad id / 404 / malformed file)
 * is pure once `fetch` is injected — so it's pinned here, not left to the un-self-verifiable shot PNG.
 */

/** A minimal `Response`-shaped stub for the injected fetch (only the fields `loadTerrainMap` reads). */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('loadTerrainMap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches /maps/<id>.json and validates it into a TerrainMap', async () => {
    const grid = { width: 2, height: 3, typeIds: [5, 1, 2, 5, 16, 1] };
    const fetchImpl = vi.fn(async () => jsonResponse(grid));

    const map = await loadTerrainMap('oasis_o_plenty', fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith('/maps/oasis_o_plenty.json');
    expect(map).toEqual(grid);
    if (map === null) throw new Error('expected a loaded map');

    // The loaded grid must flow straight through the same render seam the slice uses, carrying its
    // varied typeIds onto one tile per cell — i.e. the real map actually drives the drawn terrain.
    const scene = buildScene(EMPTY_SNAPSHOT, terrainMapToScene(map));
    const tiles = scene.filter((d) => d.kind === 'tile');
    expect(tiles).toHaveLength(6);
    expect(tiles.map((t) => t.typeId)).toEqual([5, 1, 2, 5, 16, 1]);
  });

  it('rejects an unsafe map id without fetching (no path traversal)', async () => {
    const fetchImpl = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await loadTerrainMap('../ir', fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await loadTerrainMap('a/b', fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to null on a 404 (map absent / content/ not generated)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, false, 404));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await loadTerrainMap('nope', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('falls back to null on a malformed grid (length != width*height)', async () => {
    // typeIds shorter than width*height — parseTerrainMap's zod refinement must reject it, and the
    // loader swallows the throw into a null fallback so the entry degrades to the synthetic strip.
    const bad = { width: 3, height: 3, typeIds: [1, 2] };
    const fetchImpl = vi.fn(async () => jsonResponse(bad));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await loadTerrainMap('truncated', fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});

describe('sliceTerrain', () => {
  it('projects an injected map, else the synthetic grass strip', () => {
    // Default (no map) = the reproducible 6×1 grass strip the shot PNG + golden depend on.
    const fallback = sliceTerrain();
    expect(fallback.width).toBe(6);
    expect(fallback.height).toBe(1);
    expect(fallback.typeIds).toEqual([0, 0, 0, 0, 0, 0]);

    // An injected (loaded) map drives the terrain instead.
    const loaded = sliceTerrain({ width: 2, height: 1, typeIds: [4, 9] });
    expect(loaded).toEqual({ width: 2, height: 1, typeIds: [4, 9] });
  });
});

describe('runSlice on a loaded map', () => {
  beforeEach(clearStores);

  // A small HALF-CELL grid (runSlice takes the sim's node-resolution map) with typeIds the synthetic
  // strip never declares (5, 16, 22, …) — folding them into the demo content is exactly what lets the
  // sim's node-graph build over a real decoded map.
  function gridMap(): TerrainMap {
    return {
      resolution: 'half-cell',
      width: 4,
      height: 3,
      typeIds: [5, 16, 22, 5, 5, 16, 22, 5, 5, 16, 22, 5],
    };
  }

  it('builds + steps the sim over the real grid without a content gap', () => {
    // The plain strip uses only typeIds {0,1}; this grid uses {5,16,22}. If the global sandbox content did
    // not fold those in, buildTerrainGraph would throw "landscape typeId N absent from content".
    const sim = runSlice(7, 30, gridMap());
    expect(sim.terrain?.width).toBe(4);
    expect(sim.terrain?.height).toBe(3);
    expect(sim.terrain?.nodeCount).toBe(12);
  });

  it('places the slice entities on the first walkable cells of the grid, not the strip', () => {
    const { Position, Building, Settler, Resource, DeliveryFlag } = components;
    // ticks=1 so the placeBuilding/spawnSettler commands (applied on tick 1) have run — the two wood
    // nodes are created directly, but the command entities only exist after the first step.
    const sim = runSlice(7, 1, gridMap());

    // Seven positioned entities: HQ + sawmill (Building), woodcutter + carrier (Settler), two wood nodes
    // (Resource), and the woodcutter's WORK FLAG (a Position + DeliveryFlag, auto-planted at its feet on
    // spawn — a gatherer is never free). On a 4×3 node grid whose every node is walkable, the first nodes
    // are (0,0)..(1,1) — so at least one entity must sit below the synthetic strip's single row-0 node
    // line (node row 1 = position y 0.5, so a strictly positive fixed-point y).
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
    const a = runSlice(7, 60, gridMap()).hashState();
    clearStores(); // the two runs share the global stores; isolate the second like the golden suite
    const b = runSlice(7, 60, gridMap()).hashState();
    expect(a).toBe(b);
  });

  it('falls back to the synthetic strip when a loaded map has too few walkable cells', () => {
    // typeId 1 is the demo's non-walkable water; an all-water grid has 0 walkable cells, so placement
    // can't fit the slice — runSlice must degrade to the 6×1 strip (HQ@5 etc.) rather than throw.
    const allWater: TerrainMap = {
      resolution: 'half-cell',
      width: 3,
      height: 3,
      typeIds: new Array(9).fill(1),
    };
    expect(() => runSlice(7, 1, allWater)).not.toThrow();
    clearStores();
    const fallback = runSlice(7, 1, allWater).hashState();
    clearStores();
    const strip = runSlice(7, 1).hashState();
    // Falling back means the sim is byte-identical to the no-map slice (same content, terrain, cells).
    expect(fallback).toBe(strip);
  });
});

describe('runBareMap (imported map with no authored entities)', () => {
  beforeEach(clearStores);

  function gridMap(): TerrainMap {
    return {
      resolution: 'half-cell',
      width: 4,
      height: 3,
      typeIds: [5, 16, 22, 5, 5, 16, 22, 5, 5, 16, 22, 5],
    };
  }

  it('builds a navigable sim over the real grid but places NO demo entities', () => {
    const { Position, Building, Settler } = components;
    // The `?map=` viewer's default for a plain imported map: the map's own trees/ore spawn separately
    // (spawnMapResources, in the entry), so the bare sim itself must carry NONE of the synthetic
    // HQ/joinery/gatherer/carrier demo cluster that used to land on every map's top-left.
    const sim = runBareMap(7, gridMap());
    expect(sim.terrain?.nodeCount).toBe(12);
    expect([...sim.world.query(Position)]).toHaveLength(0);
    expect([...sim.world.query(Building)]).toHaveLength(0);
    expect([...sim.world.query(Settler)]).toHaveLength(0);
  });

  it('is deterministic over the loaded map (same seed+map ⇒ same hash)', () => {
    const a = runBareMap(7, gridMap()).hashState();
    clearStores();
    const b = runBareMap(7, gridMap()).hashState();
    expect(a).toBe(b);
  });
});

describe('authored placements (map.cif StaticObjects → sim commands)', () => {
  beforeEach(clearStores);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 6×6 all-grass CELL grid (demo typeId 5, walkable), upsampled to the sim's 12×12 node lattice —
   *  authored half-cell coords run 0..11 on each axis and bounds-check against those node dims. */
  function authoredMap(): TerrainMap {
    return halfCellMapFromCells({ width: 6, height: 6, typeIds: new Array(36).fill(5) });
  }

  // The narrow IR rows the joins read: two barracks levels, one job, one tribe — the same by-name
  // keys the real ir.json carries (buildingBobs editName+level, jobs name, tribes id).
  const rows: AuthoredJoinRows = {
    buildingBobs: [
      { editName: 'viking barracks', level: 0, typeId: 30, tribeId: 1 },
      { editName: 'viking barracks', level: 1, typeId: 31, tribeId: 1 },
    ],
    buildings: [
      { typeId: 30, id: 'barracks', kind: 'workplace' },
      { typeId: 31, id: 'barracks_l1', kind: 'workplace' },
    ],
    jobs: [{ typeId: 7, id: 'builder', name: 'builder' }],
    tribes: [{ typeId: 1, id: 'viking' }],
  };

  const entities = {
    buildings: [
      // Resolves: editName+level → typeId 30; half-cell (8,4) passes VERBATIM; 0-based player 0 stays 0.
      { name: 'viking barracks', level: 0, player: 0, hx: 8, hy: 4, rot: 0 },
      // An out-of-range player (≥ MAX_PLAYERS) leaves the building neutral: owner omitted.
      { name: 'viking barracks', level: 1, player: 99, hx: 0, hy: 0 },
      { name: 'unknown house', level: 0, player: 0, hx: 2, hy: 2 }, // no buildingBobs row → skipped
      { name: 'viking barracks', level: 0, player: 0, hx: 99, hy: 0 }, // hx 99 ≥ node width 12 → skipped
    ],
    humans: [
      // Resolves: role → job typeId 7, tribe → typeId 1; node (3,5) verbatim; 0-based player 0 stays 0.
      { tribe: 'viking', role: 'builder', player: 0, hx: 3, hy: 5 },
      { tribe: 'viking', role: 'mystery_role', player: 0, hx: 3, hy: 5 }, // unknown role → skipped
    ],
    animals: [{ species: 'deer', hx: 1, hy: 1 }], // deferred (herd semantics) — never a placement
  };

  it('joins by name, passes half-cells verbatim, and stamps the 0-based players as owners', () => {
    const { placements, skipped } = resolveAuthoredPlacements(entities, rows, authoredMap());
    expect(placements).toEqual([
      { kind: 'building', typeId: 30, tribe: 1, x: 8, y: 4, owner: 0 },
      { kind: 'building', typeId: 31, tribe: 1, x: 0, y: 0 }, // no owner: player out of range
      { kind: 'human', jobType: 7, tribe: 1, x: 3, y: 5, owner: 0 },
    ]);
    expect(skipped).toBe(3);
  });

  it('runAuthoredSlice places the resolved buildings + settlers at their authored nodes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // skipped-rows warning is expected here
    const { Position, Building, Settler } = components;
    // ticks=1: placeBuilding/spawnSettler commands apply on the first step.
    const sim = runAuthoredSlice(7, 1, authoredMap(), entities, rows);
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
  });

  it('returns null when nothing resolves (caller falls back to the demo slice)', () => {
    const unresolvable = {
      buildings: [{ name: 'unknown house', level: 0, player: 1, hx: 2, hy: 2 }],
      humans: [],
      animals: [],
    };
    expect(runAuthoredSlice(7, 1, authoredMap(), unresolvable, rows)).toBeNull();
  });

  it('is deterministic (same seed + same authored entities ⇒ same hash)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = runAuthoredSlice(7, 40, authoredMap(), entities, rows)?.hashState();
    clearStores();
    const b = runAuthoredSlice(7, 40, authoredMap(), entities, rows)?.hashState();
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });
});
