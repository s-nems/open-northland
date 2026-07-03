import {
  type ContentSet,
  IR_VERSION,
  type TerrainMapFile,
  parseContentSet,
  parseTerrainMap,
} from '@vinland/data';
import { type SceneTerrain, terrainMapToScene } from '@vinland/render';
import { Simulation, type TerrainMap, components, fx } from '@vinland/sim';
import { type GoodRef, HARVEST_ATOMIC } from '../content/settler-gfx.js';

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

const { Position, Resource } = components;

const WIDTH = 6;
const HEIGHT = 1;

/** The fixed placement cells on the synthetic 6×1 strip: [HQ, sawmill, woodcutter, carrier, tree, tree]. */
const STRIP_CELLS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 5, y: 0 },
  { x: 4, y: 0 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 3, y: 0 },
];

/** The two landscape types the synthetic strip uses (grass walkable, water blocking). */
const BASE_LANDSCAPE = [
  { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
  { typeId: 1, id: 'water', walkable: false, buildable: false },
];

/**
 * The landscape table for the demo's content set. Without a map it is the two-type synthetic strip.
 *
 * A loaded `content/maps/<id>.json` references many landscape typeIds the synthetic strip never uses
 * (a real grid carries e.g. `{1,2,5,10,11,…,37}`), and `buildTerrainGraph` throws on any typeId
 * absent from content — so when a map is given we synthesize a walkable `LandscapeType` for every id
 * the grid actually contains that the base table doesn't already cover. This is purely so the demo
 * sim can navigate a real grid; it carries NO real walkability/valency semantics (that is the IR's
 * job — the demo content is explicitly synthetic). Ids are emitted in ascending order so the content
 * set is deterministic.
 */
function demoLandscape(
  map?: TerrainMap,
): Array<{ typeId: number; id: string; walkable: boolean; buildable: boolean }> {
  if (map === undefined) return BASE_LANDSCAPE;
  const covered = new Set(BASE_LANDSCAPE.map((t) => t.typeId));
  const extra = [...new Set(map.typeIds)].filter((id) => !covered.has(id)).sort((a, b) => a - b);
  return [
    ...BASE_LANDSCAPE,
    ...extra.map((id) => ({ typeId: id, id: `terrain_${id}`, walkable: true, buildable: true })),
  ];
}

/**
 * A small synthetic content set sufficient to render + navigate the vertical slice (no copyrighted
 * data). When a `map` is passed, its landscape typeIds are folded into the table (see
 * {@link demoLandscape}) so the sim's cell-graph can be built over a real decoded grid.
 */
/** The slice's haulable goods as `(typeId, id)` pairs — shared by {@link demoContent} (which adds the
 *  sim-side fields) and the render binding (the per-good carry-look join keys, see `content/settler-gfx.ts`). */
const WOOD_GOOD = { typeId: WOOD, id: 'wood' } as const;
const PLANK_GOOD = { typeId: 2, id: 'plank' } as const;

/** The goods the slice sim actually runs, for the sprite sheet's per-good carry binding (`main.ts`). */
export function demoGoods(): readonly GoodRef[] {
  return [WOOD_GOOD, PLANK_GOOD];
}

function demoContent(map?: TerrainMap): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-demo-slice' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { ...WOOD_GOOD, weight: 1, atomics: { harvest: HARVEST_ATOMIC } },
      { ...PLANK_GOOD, weight: 1 },
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
    landscape: demoLandscape(map),
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [{ jobType: WOODCUTTER, atomicId: HARVEST_ATOMIC, animation: 'viking_chop' }],
      },
    ],
    // The renderer animates the chop at a fixed cadence (one frame/tick) off the atomic's `elapsed`, and
    // the atomic is removed on the tick it completes (render only ever sees elapsed 1..length-1). The
    // CHOP binding plays the full 15-frame woodcut loop starting at the windup (phaseStart 9 → frames
    // 9..14 raise the axe, then 0..8 swing down to the impact). length 16 → render sees elapsed 1..15 →
    // all 15 frames, ending on frame 8 (the strike landing in the tree), then the chop completes and
    // wood is taken. The complete swing — windup then strike — at constant speed. ~0.8s at 20 ticks/s.
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: 16 }],
  });
}

function grassMap(): TerrainMap {
  return { width: WIDTH, height: HEIGHT, typeIds: new Array(WIDTH * HEIGHT).fill(GRASS) };
}

/**
 * The terrain grid the scene layer projects, derived from the SAME {@link TerrainMap} the sim
 * navigates via the render package's `terrainMapToScene` seam — so the demo exercises the exact
 * map→scene path a loaded `content/maps/<id>.json` takes, not a hand-duplicated grid.
 *
 * When a `map` is passed (loaded from disk via {@link loadTerrainMap}), its varied landscape typeIds
 * carry through; otherwise the synthetic grass strip is projected — the reproducible default for
 * `npm run shot` + the unit tests, which must not depend on the gitignored `content/`.
 */
export function sliceTerrain(map?: TerrainMap | TerrainMapFile): SceneTerrain {
  return terrainMapToScene(map ?? grassMap());
}

/**
 * A map id is a bare filename stem (no slashes/dots), so `?map=oasis_o_plenty` can only ever fetch a
 * single `content/maps/<id>.json` — never a traversal out of the maps dir. Returns null for an id that
 * isn't a safe stem, so the caller falls back to the synthetic strip rather than fetching junk.
 */
function safeMapId(id: string): string | null {
  return /^[a-z0-9_-]+$/i.test(id) ? id : null;
}

/**
 * Load a decoded map grid (`content/maps/<id>.json`, served at `/maps/<id>.json` by the dev/shot vite
 * middleware) into the structural {@link TerrainMap} the renderer + sim consume. This is the app's
 * **I/O boundary** (a browser `fetch`, not allowed in the pure sim): it pulls the JSON and hands it to
 * `@vinland/data`'s `parseTerrainMap`, which zod-validates the shape + the `typeIds.length ===
 * width*height` invariant before it ever reaches `terrainMapToScene`/`buildTerrainGraph`. Returns null
 * (and logs) on a bad id, a 404 (no such map / `content/` absent), or a malformed file, so the entry
 * degrades gracefully to the synthetic strip — the real maps are gitignored, so a checkout without
 * them still renders. `fetchImpl` is injectable so the validate-then-project core is unit-testable
 * without a network.
 */
export async function loadTerrainMap(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TerrainMapFile | null> {
  const safe = safeMapId(id);
  if (safe === null) {
    console.warn(`loadTerrainMap: ignoring unsafe map id "${id}"`);
    return null;
  }
  try {
    const res = await fetchImpl(`/maps/${safe}.json`);
    if (!res.ok) {
      console.warn(`loadTerrainMap: /maps/${safe}.json -> HTTP ${res.status} (falling back to the strip)`);
      return null;
    }
    return parseTerrainMap(await res.json());
  } catch (err) {
    console.warn(`loadTerrainMap: failed to load "${safe}" (${String(err)}); falling back to the strip`);
    return null;
  }
}

/** The six placement slots the slice needs: HQ, sawmill, woodcutter, carrier, and two wood nodes. */
const PLACEMENT_CELL_COUNT = 6;

/**
 * The first `count` walkable cells of `map`, in canonical row-major id order, as integer `(x, y)`
 * tile coords — or `null` if the map has fewer than `count` walkable cells. "Walkable" is resolved
 * from the demo content's landscape table (the same `walkable` flag `buildTerrainGraph` reads), so
 * the slice's entities land only on cells the sim can stand on — placing a building on water would
 * make the woodcutter's path unreachable. Deterministic: a fixed scan order, no RNG.
 *
 * Returns `null` (a recoverable boundary failure, not a throw) for a map with too few walkable cells:
 * some real grids are ~all water under the demo's two-type base table (e.g. a coastal scenario whose
 * land is all typeId 1), and `runSlice` falls back to the synthetic strip rather than crashing the
 * shot/dev entry — the same graceful-degradation contract as {@link loadTerrainMap}.
 */
function walkableCells(
  map: TerrainMap,
  walkable: ReadonlySet<number>,
  count: number,
): Array<{ x: number; y: number }> | null {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < map.typeIds.length && out.length < count; i++) {
    const typeId = map.typeIds[i];
    if (typeId !== undefined && walkable.has(typeId))
      out.push({ x: i % map.width, y: Math.floor(i / map.width) });
  }
  return out.length < count ? null : out;
}

/**
 * The set of landscape typeIds the demo marks walkable for a given map — the placement filter for
 * {@link walkableCells}. Derived from {@link demoLandscape} (the same table `demoContent` feeds the
 * sim), so the "walkable" answer here is exactly what `buildTerrainGraph` will resolve, without
 * paying for a full `parseContentSet`.
 */
function walkableTypeIds(map?: TerrainMap): ReadonlySet<number> {
  return new Set(
    demoLandscape(map)
      .filter((t) => t.walkable)
      .map((t) => t.typeId),
  );
}

/**
 * Build the vertical-slice simulation (seed-fixed) and run it `ticks` ticks deterministically. The
 * returned sim is at a tick boundary, ready for `snapshot()` → `buildScene` → the renderer. No RAF,
 * no wall-clock: this is the "render scenario X at seed S, step N ticks" entry the harness needs.
 *
 * Without a `map` the slice runs on the synthetic 6×1 grass strip (the reproducible default the shot
 * PNG depends on). With a loaded `content/maps/<id>.json` grid, the SAME six entities (HQ, sawmill,
 * woodcutter, carrier, two wood nodes) are placed on the first walkable cells of the real grid instead
 * of the hardcoded strip — so the sim actually navigates the decoded map, not a stand-in. The grid's
 * landscape typeIds are folded into the demo content (see {@link demoContent}) so its cell-graph
 * builds; placement uses {@link walkableCells} so nothing lands on a blocking cell. A loaded map with
 * too few walkable cells (an all-water grid under the demo's base table) **falls back to the strip**
 * — the slice always runs (matching the file's graceful-degradation contract), never throwing.
 */
export function runSlice(seed: number, ticks: number, map?: TerrainMap, owner?: number): Simulation {
  // Resolve placement first: a usable map yields its first six walkable cells; no map (or a map with
  // too few walkable cells) falls back to the synthetic strip — content + terrain + cells all revert
  // together so the fallback sim is exactly the no-map slice.
  const mapCells = map ? walkableCells(map, walkableTypeIds(map), PLACEMENT_CELL_COUNT) : null;
  const usable = map !== undefined && mapCells !== null;
  const content = demoContent(usable ? map : undefined);
  const terrain = usable ? map : grassMap();
  const cells = mapCells ?? STRIP_CELLS;
  const sim = new Simulation({ seed, content, map: terrain });

  const cellAt = (i: number): { x: number; y: number } => {
    const c = cells[i];
    if (c === undefined)
      throw new Error(`expected ${PLACEMENT_CELL_COUNT} placement cells, got ${cells.length}`);
    return c;
  };
  const hq = cellAt(0);
  const mill = cellAt(1);
  const cutter = cellAt(2);
  const carrier = cellAt(3);

  // `owner` (optional) tags the slice's buildings + settlers to a player so they're selectable/orderable
  // in the interactive live entry. Omitted (the shot/default path) leaves them neutral — hash untouched.
  const own = owner !== undefined ? { owner } : {};
  sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: hq.x, y: hq.y, tribe: VIKING, ...own });
  sim.enqueue({ kind: 'placeBuilding', buildingType: SAWMILL, x: mill.x, y: mill.y, tribe: VIKING, ...own });
  sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: cutter.x, y: cutter.y, tribe: VIKING, ...own });
  sim.enqueue({ kind: 'spawnSettler', jobType: CARRIER, x: carrier.x, y: carrier.y, tribe: VIKING, ...own });
  for (const cell of [cellAt(4), cellAt(5)]) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(cell.x), y: fx.fromInt(cell.y) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
  }
  sim.run(ticks);
  return sim;
}
