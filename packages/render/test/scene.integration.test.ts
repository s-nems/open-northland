import type { GfxInHouseProgram } from '@open-northland/data';
import { components, fx, Simulation, systems, type TerrainMap } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { collectSpriteScene } from '../src/data/scene/index.js';
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
/** Any atomic id: the program lookup below answers every one. */
const CRAFT_ATOMIC = 47;

const { addCurrentAtomic, Building, Position, Resource, Resting, Settler } = components;

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

describe('buildScene over a real Simulation snapshot', () => {
  it('renders the vertical-slice world: terrain behind, every entity drawn and depth-sorted', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(6, 1) });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: SAWMILL, x: 4, y: 0, tribe: VIKING });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: CARRIER, x: 1, y: 0, tribe: VIKING });
    for (const x of [2, 3]) {
      const tree = sim.world.create();
      sim.world.add(tree, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
      sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
      systems.stampResourceFootprintOrFallback(sim.world, sim.content, tree, WOOD);
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

describe('a workplace craft over a real Simulation snapshot', () => {
  it('draws the worker its program choreographs, clocked by the atomic the sim runs', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(6, 1) });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: SAWMILL, x: 4, y: 0, tribe: VIKING });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.run(1);
    const [sawmill] = sim.world.query(Building);
    const [worker] = sim.world.query(Settler);
    if (sawmill === undefined || worker === undefined) throw new Error('setup placed no sawmill or worker');
    const craft = { kind: 'produce', recipeOutput: WOOD } as const;
    sim.world.add(worker, Resting, { at: sawmill });
    addCurrentAtomic(
      sim.world,
      worker,
      { atomicId: CRAFT_ATOMIC, duration: 100, effect: craft, targetEntity: sawmill, targetTile: null },
      30,
    );
    const program: GfxInHouseProgram = {
      tribe: VIKING,
      job: WOODCUTTER,
      action: CRAFT_ATOMIC,
      entries: [{ kind: 'clip', action: CRAFT_ATOMIC, subId: 1, dir: 0, from: 20, to: 60 }],
    };

    const scene = collectSpriteScene(sim.snapshot(), { inHousePrograms: () => program });

    const drawn = scene.items.find((i) => i.kind === 'settler');
    expect(drawn).toMatchObject({ inHouse: true, state: 'acting' });
    expect(drawn?.craftClip).toEqual({ action: CRAFT_ATOMIC, subId: 1, progress: 0.25 });
  });
});
