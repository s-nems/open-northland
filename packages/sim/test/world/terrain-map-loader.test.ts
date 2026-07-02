import { parseTerrainMap } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { MoveGoal, PathFollow, PathRequest, Position } from '../../src/components/index.js';
import { Simulation, fx, scenario } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The loader seam: a decoded `content/maps/<id>.json` grid (the shape the pipeline's
 * `convertMapDatTree` emits — `{ width, height, typeIds }`) is validated by `parseTerrainMap` and fed
 * into the sim in place of the synthetic grass grid. This is the last leg of the terrain-graph item:
 * proving a real map's grid loads → `buildTerrainGraph` → navigation, all the way through the harness.
 *
 * `parseTerrainMap` runs at the I/O boundary (the build tool / app read the JSON; the pure sim never
 * does), so these tests parse a JSON *string* exactly as a file read would yield, then drive the sim.
 */

const GRASS = 0; // fixture landscape typeId 0 — walkable
const WATER = 1; // fixture landscape typeId 1 — not walkable

// Component stores are module-level singletons, so clear the ones these cases touch before each test
// to keep membership assertions and hash equality scoped to the current case (see ai-system.test.ts).
beforeEach(() => {
  Position.store.clear();
  MoveGoal.store.clear();
  PathFollow.store.clear();
  PathRequest.store.clear();
});

/**
 * The literal text of a `content/maps/<id>.json` file: a 5×5 grass field with a water wall down
 * column x=2 except a gap at the bottom row (y=4) — a route exists only around the wall, so a pathing
 * settler must detour, exercising the real decoded grid the same way a map file would.
 */
function mapFileJson(): string {
  const W = 5;
  const H = 5;
  const typeIds: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      typeIds.push(x === 2 && y !== 4 ? WATER : GRASS);
    }
  }
  return JSON.stringify({ width: W, height: H, typeIds });
}

describe('parseTerrainMap (the content/maps loader)', () => {
  it('validates a well-formed map file into a structural TerrainMap', () => {
    const map = parseTerrainMap(JSON.parse(mapFileJson()));
    expect(map.width).toBe(5);
    expect(map.height).toBe(5);
    expect(map.typeIds.length).toBe(25);
  });

  it('rejects a grid whose typeIds length disagrees with width*height', () => {
    expect(() => parseTerrainMap({ width: 3, height: 3, typeIds: [0, 0, 0] })).toThrow(/length 3 != /);
  });

  it('rejects a non-integer / negative cell typeId', () => {
    expect(() => parseTerrainMap({ width: 1, height: 1, typeIds: [-1] })).toThrow();
  });
});

describe('a loaded map drives the sim in place of the synthetic grass grid', () => {
  it('feeds a parsed content/maps grid through scenario({ map }) into a real terrain graph', () => {
    const map = parseTerrainMap(JSON.parse(mapFileJson()));
    const sim = scenario(testContent(), { seed: 7, map }).run(0).sim;
    // The graph was built from the loaded grid: 25 cells, the centre column blocked, the gap open.
    expect(sim.terrain?.cellCount).toBe(25);
    expect(sim.terrain?.isWalkable(sim.terrain.cellAt(2, 0))).toBe(false); // water wall
    expect(sim.terrain?.isWalkable(sim.terrain.cellAt(2, 4))).toBe(true); // the gap
  });

  it('a settler navigates the loaded map (detours around the water wall) deterministically', () => {
    function run(): { ticks: number; arrived: boolean; hash: string } {
      Position.store.clear();
      MoveGoal.store.clear();
      PathFollow.store.clear();
      PathRequest.store.clear();
      const map = parseTerrainMap(JSON.parse(mapFileJson()));
      const sim = new Simulation({ seed: 7, content: testContent(), map });
      // A lone mover at (0,0) given only a MoveGoal to (4,0): the navigation planner must issue a
      // PathRequest, A* must route around the water wall through the y=4 gap, MovementSystem walks it.
      const goal = sim.terrain?.cellAt(4, 0) ?? 0;
      const e = sim.world.create();
      sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
      sim.world.add(e, MoveGoal, { cell: goal });
      let ticks = 0;
      while (sim.world.has(e, MoveGoal) && ticks < 500) {
        sim.step();
        ticks++;
      }
      return { ticks, arrived: !sim.world.has(e, MoveGoal), hash: sim.hashState() };
    }
    const a = run();
    const b = run();
    expect(a.arrived).toBe(true);
    expect(a.ticks).toBeLessThan(500); // it actually reached the goal, not timed out
    expect(a.hash).toBe(b.hash); // same seed + same loaded map => byte-identical state
  });
});
