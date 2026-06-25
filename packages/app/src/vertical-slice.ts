import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type SceneTerrain, terrainMapToScene } from '@vinland/render';
import { Simulation, type TerrainMap, components, fx } from '@vinland/sim';

/**
 * The Phase-2 vertical-slice scenario, built deterministically so a screenshot frame is reproducible.
 *
 * This mirrors the world the render scene **integration test** exercises (a 6×1 grass strip: HQ +
 * sawmill placed via commands, a woodcutter + a carrier, two wood nodes), so the headless shot entry
 * draws the exact frame the unit tests already assert the draw list of.
 *
 * The content set here is a tiny, HAND-AUTHORED synthetic fixture — the demo twin of the sim's test
 * fixture (`packages/sim/test/fixtures/content.ts`), kept as its own copy rather than reaching into
 * another package's `test/` dir from production code (which would drag the test tree into the build
 * graph). It carries NO copyrighted game data, just enough goods/jobs/buildings to render the slice;
 * `parseContentSet` (zod) fails loudly if the schema drifts. Real content is generated into the
 * gitignored `content/` from an owned game copy (docs/TESTING.md "Reproducibility of fixtures").
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

const WIDTH = 6;
const HEIGHT = 1;

/** A small synthetic content set sufficient to render the vertical slice (no copyrighted data). */
function demoContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-demo-slice' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood', weight: 1, atomics: { harvest: HARVEST_ATOMIC } },
      { typeId: 2, id: 'plank', weight: 1 },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [HARVEST_ATOMIC] },
      { typeId: 2, id: 'carpenter' },
      { typeId: CARRIER, id: 'carrier' },
    ],
    buildings: [
      {
        typeId: HEADQUARTERS,
        id: 'headquarters',
        kind: 'headquarters',
        workers: [{ jobType: WOODCUTTER, count: 3 }],
        stock: [
          { goodType: WOOD, capacity: 150, initial: 10 },
          { goodType: 2, capacity: 150, initial: 0 },
        ],
      },
      {
        typeId: SAWMILL,
        id: 'sawmill',
        kind: 'workplace',
        workers: [{ jobType: 2, count: 1 }],
        stock: [
          { goodType: WOOD, capacity: 20, initial: 0 },
          { goodType: 2, capacity: 20, initial: 0 },
        ],
        recipe: { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [{ goodType: 2, amount: 1 }], ticks: 20 },
      },
    ],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: 1, id: 'water', walkable: false, buildable: false },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [{ jobType: WOODCUTTER, atomicId: HARVEST_ATOMIC, animation: 'viking_chop' }],
      },
    ],
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: 3 }],
  });
}

function grassMap(): TerrainMap {
  return { width: WIDTH, height: HEIGHT, typeIds: new Array(WIDTH * HEIGHT).fill(GRASS) };
}

/**
 * The terrain grid the scene layer projects, derived from the SAME {@link TerrainMap} the sim
 * navigates via the render package's `terrainMapToScene` seam — so the demo exercises the exact
 * map→scene path a loaded `content/maps/<id>.json` takes, not a hand-duplicated grid.
 */
export function sliceTerrain(): SceneTerrain {
  return terrainMapToScene(grassMap());
}

/**
 * Build the vertical-slice simulation (seed-fixed) and run it `ticks` ticks deterministically. The
 * returned sim is at a tick boundary, ready for `snapshot()` → `buildScene` → the renderer. No RAF,
 * no wall-clock: this is the "render scenario X at seed S, step N ticks" entry the harness needs.
 */
export function runSlice(seed: number, ticks: number): Simulation {
  const sim = new Simulation({ seed, content: demoContent(), map: grassMap() });
  sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'placeBuilding', buildingType: SAWMILL, x: 4, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: CARRIER, x: 1, y: 0, tribe: VIKING });
  for (const x of [2, 3]) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
  }
  sim.run(ticks);
  return sim;
}
