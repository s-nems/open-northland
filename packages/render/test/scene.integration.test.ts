import { components, fx, Simulation, type TerrainMap } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { buildScene, type SceneTerrain } from '../src/index.js';

/**
 * Integration smoke over a real `Simulation.snapshot()` rather than a hand-built one, so the
 * snapshot-to-scene seam meets real component data: Maps cloned to arrays, Fixed positions, the actual
 * entity set. `scene/build-scene.test.ts` owns the projection and sort logic on synthetic snapshots.
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

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
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

    const lastTile = scene.map((d) => d.kind).lastIndexOf('tile');
    const firstSprite = scene.findIndex((d) => d.kind !== 'tile');
    expect(lastTile).toBeLessThan(firstSprite);

    // A second snapshot of the same state yields the same scene.
    const again = buildScene(sim.snapshot(), terrain);
    expect(JSON.stringify(again)).toBe(JSON.stringify(scene));
  });
});
