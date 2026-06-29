import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, type TerrainMap, components, fx } from '@vinland/sim';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: the gather loop over a **serpentine, walled map** — a pathfinding + directional-
 * animation stress test. Unlike `gather-resource`'s open grass strip (where the worker walks an almost
 * straight line), here three full-width water barriers with offset single-cell gaps force the woodcutter
 * to SNAKE: walk east to a gap, drop a band, walk back west to the next gap, drop again, and so on down
 * to the trees — then haul the wood back up the same maze.
 *
 * Two things a human watches for that the flat scene can't show:
 *  - **Pathfinding** bends the route around the walls (it is visibly NOT a straight line), and
 *  - the settler **turns to face each leg** — across the full descend-empty / ascend-loaded loop it walks
 *    in all four grid directions, so over the loop it shows all four even isometric facings (SW/NW/NE/SE).
 *    Each leg alone shows three (the empty descent SW/NW/SE, the loaded carry NW/NE/SE), so BOTH the empty
 *    walk and the loaded `..._walk_wood` carry gait are exercised, just not all four facings within one.
 *
 * LIMITATION (pinned, not a bug): the pathfinder is 4-connected (N/E/S/W; `packages/sim/src/nav/terrain.ts`),
 * so legs are axis-aligned on the grid and project to only the FOUR even isometric facings — the four odd
 * (screen-cardinal) facings need diagonal grid movement an 8-connected pathfinder would add (a separate,
 * larger slice; see docs/FIDELITY.md). This scene exercises everything the current movement supports.
 *
 * No new mechanics: same harvest → carry → deposit chain as `gather-resource`, just a harder map. Carries
 * NO copyrighted data (synthetic content; the decoded sprites live in the gitignored `content/`).
 */

const GRASS = 0;
const WATER = 9; // a non-walkable landscape type — the maze walls (the pathfinder routes around it)
const WOOD = 1;
const WOODCUTTER = 1;
const HEADQUARTERS = 1;
const VIKING = 1;
/** The chop atomic id — the good's `atomics.harvest`, bound to the viking woodcutting swing (render). */
const HARVEST_ATOMIC = 24;

const { Building, Position, Resource, Stockpile } = components;

const WIDTH = 9;
const HEIGHT = 9;

/** The HQ + worker start in the top-left, the trees in the bottom band — a long snaking haul between them. */
const HQ = { x: 0, y: 0 };
const WOODCUTTER_START = { x: 1, y: 0 };
const TREES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 3, y: 8 },
  { x: 6, y: 8 },
];
/** Units each tree yields before it empties — enough for several full snaking gather cycles to watch. */
const TREE_REMAINING = 8;

/**
 * Full-width water barriers at rows 2 / 4 / 6, each with ONE gap, alternating right/left/right. Only the
 * gap column lets a unit pass between bands, so the single forced route snakes E → (gap 8) → W → (gap 0)
 * → E → (gap 8) → down to the trees.
 */
const WALLS: ReadonlyArray<{ row: number; gapX: number }> = [
  { row: 2, gapX: WIDTH - 1 }, // gap on the right
  { row: 4, gapX: 0 }, // gap on the left
  { row: 6, gapX: WIDTH - 1 }, // gap on the right
];

/** Stamp the {@link WALLS} as WATER over an all-GRASS grid — the row-major landscape grid the cell graph walks. */
function angledTerrain(): TerrainMap {
  const typeIds = new Array<number>(WIDTH * HEIGHT).fill(GRASS);
  for (const wall of WALLS) {
    for (let x = 0; x < WIDTH; x++) {
      if (x === wall.gapX) continue; // leave the single passage open
      typeIds[wall.row * WIDTH + x] = WATER;
    }
  }
  return { width: WIDTH, height: HEIGHT, typeIds };
}

/**
 * The same tiny synthetic content as `gather-resource` (one good/job/building/tribe driving the gather
 * loop), plus the non-walkable {@link WATER} landscape the maze walls are made of. `buildTerrainGraph`
 * throws on a map typeId absent from this table, so WATER must be declared here even though nothing is
 * placed on it.
 */
function angledContent(): ContentSet {
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
        stock: [{ goodType: WOOD, capacity: 150, initial: 0 }],
      },
    ],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [{ jobType: WOODCUTTER, atomicId: HARVEST_ATOMIC, animation: 'viking_chop' }],
      },
    ],
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: 16 }],
  });
}

/** Place the HQ + the woodcutter (via commands) and the trees (direct resource entities), as in the slice. */
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

export const angledPathScene: SceneDefinition = {
  id: 'angled-path',
  title: 'Ścieżka pod kątem (labirynt)',
  summary:
    'Drwal pokonuje labirynt z wodnymi ścianami (wąskie przejścia naprzemiennie z prawej/lewej): idzie zygzakiem do drzew, ścina i niesie drewno z powrotem do HQ tą samą krętą drogą — test pathfindingu i animacji (chód + niesienie) w wielu kierunkach.',
  seed: 7,
  content: angledContent(),
  terrain: angledTerrain(),
  build,
  // The snaking haul is long (~30 tiles each way at 4 ticks/tile, plus chops); give it room for several
  // full descend-empty / ascend-loaded cycles so the deposit count clearly rises (verified offline).
  runTicks: 1400,
  checklist: [
    'Trasa drwala NIE jest prosta — pathfinding prowadzi go zygzakiem przez przejścia w ścianach',
    'Drwal obraca się w stronę kierunku marszu na każdym odcinku (różne kąty)',
    'Po dojściu do drzewa odpala się animacja ścinania (rąbanie)',
    'W drodze powrotnej widać animację NIESIENIA drewna (inna niż pusty chód) — wymaga ?atlas=real',
    'Drewno trafia do HQ i licznik surowca rośnie (panel HUD lewy-górny)',
  ],
  checks: [
    { label: 'wood reached the headquarters store', predicate: (sim) => headquartersWood(sim) > 0 },
    {
      label: 'at least one resource node was harvested',
      predicate: (sim) => totalResourceRemaining(sim) < TREES.length * TREE_REMAINING,
    },
  ],
};
