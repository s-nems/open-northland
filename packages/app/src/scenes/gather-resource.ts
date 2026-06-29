import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, type TerrainMap, components, fx } from '@vinland/sim';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: the **harvest → carry → deposit** gathering loop — the chain that already drives
 * the vertical slice, isolated to a single worker so a human can watch one full cycle and sign off.
 *
 * A lone woodcutter walks to a tree, plays the chop animation, carries the wood back to the
 * headquarters store, and deposits it (the HQ wood counter rises); when a tree empties it moves to the
 * next. No new mechanics — this proves the *acceptance-scene harness itself* end-to-end. Themed as
 * "wood" because that is what the decoded sprites animate today; a future scene can swap in clay/ore by
 * adding a good + resource to its own content (content is data, not code).
 */

const GRASS = 0;
const WOOD = 1;
const WOODCUTTER = 1;
const HEADQUARTERS = 1;
const VIKING = 1;
/** The chop atomic id — the good's `atomics.harvest`, bound to the viking woodcutting swing (render). */
const HARVEST_ATOMIC = 24;

const { Building, Position, Resource, Stockpile } = components;

const WIDTH = 7;
const HEIGHT = 5;

/** Fixed placements on the all-grass grid, spaced so the walk to the tree and back to the HQ is visible. */
const HQ = { x: 5, y: 1 };
const WOODCUTTER_START = { x: 1, y: 3 };
const TREES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 2, y: 2 },
  { x: 3, y: 3 },
];
/** Units each tree yields before it empties — enough for several full gather cycles to watch. */
const TREE_REMAINING = 6;

/**
 * A tiny synthetic content set: just enough goods/jobs/buildings to drive one woodcutter's gather
 * loop. Carries NO copyrighted data (the `npm run pipeline` decode lives in the gitignored `content/`);
 * `parseContentSet` (zod) fails loudly if the schema drifts. The HQ is a passive store with a wood
 * slot (the deposit sink); the woodcutter's `allowedAtomics` permits the wood good's harvest atomic.
 */
function gatherContent(): ContentSet {
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: 'vinland-acceptance-scene' },
      locale: 'eng',
    },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood', weight: 1, atomics: { harvest: HARVEST_ATOMIC } },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [HARVEST_ATOMIC] },
    ],
    buildings: [
      {
        typeId: HEADQUARTERS,
        id: 'headquarters',
        kind: 'headquarters',
        workers: [{ jobType: WOODCUTTER, count: 1 }],
        // Start at 0 so the rising count is unmistakable on screen and in the check.
        stock: [{ goodType: WOOD, capacity: 150, initial: 0 }],
      },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [{ jobType: WOODCUTTER, atomicId: HARVEST_ATOMIC, animation: 'viking_chop' }],
      },
    ],
    // The renderer plays the full 15-frame woodcut swing off the atomic's `elapsed` (length 16 → render
    // sees elapsed 1..15). See vertical-slice.ts for the windup/strike phasing detail.
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: 16 }],
  });
}

/** An all-grass grid: every cell is walkable so placement and pathing are unconstrained. */
function gatherTerrain(): TerrainMap {
  return { width: WIDTH, height: HEIGHT, typeIds: new Array(WIDTH * HEIGHT).fill(GRASS) };
}

/** Place the HQ + the woodcutter (via commands) and the trees (direct resource entities, like the slice). */
function build(sim: Simulation): void {
  sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: HQ.x, y: HQ.y, tribe: VIKING });
  sim.enqueue({
    kind: 'spawnSettler',
    jobType: WOODCUTTER,
    x: WOODCUTTER_START.x,
    y: WOODCUTTER_START.y,
    tribe: VIKING,
  });
  for (const t of TREES) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(t.x), y: fx.fromInt(t.y) });
    sim.world.add(tree, Resource, {
      goodType: WOOD,
      remaining: TREE_REMAINING,
      harvestAtomic: HARVEST_ATOMIC,
    });
  }
}

/** Wood currently in the headquarters store — the "counter" the gather loop fills. */
function headquartersWood(sim: Simulation): number {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType === HEADQUARTERS) {
      return sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0;
    }
  }
  return 0;
}

/** Units left across all resource nodes — drops as the worker harvests. */
function totalResourceRemaining(sim: Simulation): number {
  let total = 0;
  for (const e of sim.world.query(Resource)) total += sim.world.get(e, Resource).remaining;
  return total;
}

export const gatherResourceScene: SceneDefinition = {
  id: 'gather-resource',
  title: 'Zbieranie surowca (drewno)',
  summary:
    'Drwal idzie do drzewa, ścina je, niesie drewno do magazynu (HQ) i odkłada — licznik w HQ rośnie, a po wyczerpaniu drzewa rusza do kolejnego.',
  seed: 7,
  content: gatherContent(),
  terrain: gatherTerrain(),
  build,
  runTicks: 250,
  checklist: [
    'Drwal rusza w stronę najbliższego drzewa',
    'Po dojściu odpala się animacja ścinania (rąbanie)',
    'Drwal wraca z drewnem do magazynu (HQ)',
    'Drewno trafia do HQ i licznik surowca rośnie (panel HUD lewy-górny)',
    'Po wyczerpaniu drzewa robotnik idzie do kolejnego',
  ],
  checks: [
    { label: 'wood reached the headquarters store', predicate: (sim) => headquartersWood(sim) > 0 },
    {
      label: 'at least one resource node was harvested',
      predicate: (sim) => totalResourceRemaining(sim) < TREES.length * TREE_REMAINING,
    },
  ],
};
