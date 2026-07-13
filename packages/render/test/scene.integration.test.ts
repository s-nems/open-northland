import { components, fx, Simulation, type TerrainMap } from '@open-northland/sim';
import { beforeEach, describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { buildScene, type SceneTerrain } from '../src/index.js';

/**
 * INTEGRATION smoke for the scene layer — `render` reading a REAL `Simulation.snapshot()`, not a
 * hand-built one (the unit tests in scene.test.ts cover the projection/sort logic on synthetic
 * snapshots). This is the hands-on entry point the screenshot harness will sit on: run the real
 * vertical-slice sim a few ticks, snapshot it, and assert the draw list it produces is sane —
 * the building, the woodcutter, the carrier, and the resource nodes all appear and are correctly
 * ordered behind/above the terrain. It proves the snapshot→scene seam against real component data
 * (Maps cloned to arrays, Fixed positions, the actual entity set) rather than a fixture.
 */

const GRASS = 0;
const WOOD = 1;
const WOODCUTTER = 1;
const CARRIER = 36;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const VIKING = 1;
const HARVEST_ATOMIC = 24;

const { Position, Resource } = components;

// Component stores are module-level singletons (see golden-trace.test.ts) — clear before each run.
function clearStores(): void {
  for (const c of [
    components.Position,
    components.Settler,
    components.Resource,
    components.Building,
    components.Stockpile,
    components.Carrying,
    components.CurrentAtomic,
    components.MoveGoal,
    components.PathFollow,
    components.PathRequest,
    components.Production,
  ]) {
    c.store.clear();
  }
}

beforeEach(clearStores);

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

describe('buildScene over a real Simulation snapshot', () => {
  it('renders the vertical-slice world: terrain behind, every entity drawn and depth-sorted', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(6, 1) });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'placeBuilding', buildingType: SAWMILL, x: 4, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: CARRIER, x: 1, y: 0, tribe: VIKING });
    for (const x of [2, 3]) {
      const tree = sim.world.create();
      sim.world.add(tree, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
      sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
    }

    sim.run(20);
    const snap = sim.snapshot();
    const terrain: SceneTerrain = { width: 6, height: 1, typeIds: grassMap(6, 1).typeIds };

    const scene = buildScene(snap, terrain);

    // 6 terrain tiles + 2 buildings + 2 settlers + 2 resources = 12 draw items.
    const counts: Record<string, number> = {};
    for (const d of scene) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
    expect(counts.tile).toBe(6);
    expect(counts.building).toBe(2);
    expect(counts.settler).toBe(2);
    expect(counts.resource).toBe(2);

    // All terrain strictly precedes all sprites in draw order.
    const lastTile = scene.map((d) => d.kind).lastIndexOf('tile');
    const firstSprite = scene.findIndex((d) => d.kind !== 'tile');
    expect(lastTile).toBeLessThan(firstSprite);

    // The draw list is deterministic: a second snapshot of the same state yields the same scene.
    const again = buildScene(sim.snapshot(), terrain);
    expect(JSON.stringify(again)).toBe(JSON.stringify(scene));
  });
});
