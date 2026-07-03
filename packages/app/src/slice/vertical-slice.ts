import {
  type ContentSet,
  IR_VERSION,
  type TerrainMapFile,
  parseContentSet,
  parseTerrainMap,
} from '@vinland/data';
import { type SceneTerrain, terrainMapToScene } from '@vinland/render';
import { Simulation, type TerrainMap, components, fx } from '@vinland/sim';
import { type GoodRef, HARVEST_ATOMIC, HARVEST_SWING_LENGTH } from '../content/settler-gfx.js';

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
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: HARVEST_SWING_LENGTH }],
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

/**
 * The narrow `ir.json` row views the authored-entity joins read — structural picks over the raw
 * fetched IR (the full zod `parseContentSet` over the multi-MB file is a load-time cost the entry
 * doesn't need; these are the same by-NAME join keys the engine itself uses).
 */
export interface AuthoredJoinRows {
  readonly buildingBobs?: readonly {
    editName?: string;
    level?: number;
    typeId?: number;
    tribeId?: number;
  }[];
  readonly buildings?: readonly { typeId?: number; id?: string; kind?: string }[];
  readonly jobs?: readonly { typeId?: number; id?: string; name?: string }[];
  readonly tribes?: readonly { typeId?: number; id?: string }[];
}

/** A home's non-deliverable upgrade pin (mirrors the catalog's `HOME_UPGRADE_PIN` — an EMPTY
 *  construction cost is vacuously "materials present", which would silently level every authored home
 *  to its top tier; a single undeliverable `none` unit keeps each home at its authored level). */
const AUTHORED_HOME_PIN: readonly { goodType: number; amount: number }[] = [{ goodType: 0, amount: 1 }];

/** One resolved authored placement, ready to enqueue (the pure middle {@link resolveAuthoredPlacements} returns). */
export type AuthoredPlacement =
  | { kind: 'building'; typeId: number; tribe: number; x: number; y: number; owner?: number }
  | { kind: 'human'; jobType: number; tribe: number; x: number; y: number; owner?: number };

/**
 * Resolve a map's authored `entities` (names + half-cells, verbatim from `map.cif` `StaticObjects`)
 * into sim placements — the pure, unit-testable middle of the placement import. Joins are by NAME
 * against the IR rows (a building's `EditName`+`level` → `buildingBobs` typeId+tribe; a human's
 * `role` → `jobs` typeId, its `tribe` string → `tribes` typeId), half-cells halve to cells, and the
 * two player columns land on 0-based sim owners (`sethouse` is 1-based, `sethuman` 0-based — schema
 * notes). Unresolvable or out-of-bounds records are dropped and counted; `setanimal` records are not
 * placed yet (herd-vs-individual semantics, docs/FIDELITY.md).
 */
export function resolveAuthoredPlacements(
  entities: NonNullable<TerrainMapFile['entities']>,
  rows: AuthoredJoinRows,
  map: TerrainMap,
): { placements: AuthoredPlacement[]; skipped: number } {
  const bobByNameLevel = new Map<string, { typeId: number; tribeId: number }>();
  for (const b of rows.buildingBobs ?? []) {
    if (b.editName === undefined || b.typeId === undefined) continue;
    // NUL-separated key: a plain space would let `"foo 1" L0` collide with `"foo" L10`.
    const key = `${b.editName}\u0000${b.level ?? 0}`;
    if (!bobByNameLevel.has(key)) bobByNameLevel.set(key, { typeId: b.typeId, tribeId: b.tribeId ?? 0 });
  }
  const jobByName = new Map<string, number>();
  for (const j of rows.jobs ?? []) {
    const name = j.name ?? j.id;
    if (name !== undefined && j.typeId !== undefined && !jobByName.has(name)) jobByName.set(name, j.typeId);
  }
  const tribeByName = new Map<string, number>();
  for (const t of rows.tribes ?? []) {
    if (t.id !== undefined && t.typeId !== undefined && !tribeByName.has(t.id))
      tribeByName.set(t.id, t.typeId);
  }
  const half = (h: number): number => Math.floor(h / 2);
  const inBounds = (hx: number, hy: number): boolean =>
    hx >= 0 && hy >= 0 && half(hx) < map.width && half(hy) < map.height;

  const placements: AuthoredPlacement[] = [];
  let skipped = 0;
  for (const b of entities.buildings) {
    const hit = bobByNameLevel.get(`${b.name}\u0000${b.level}`);
    if (hit === undefined || !inBounds(b.hx, b.hy)) {
      skipped++;
      continue;
    }
    const own = b.player - 1; // sethouse players are 1-based
    placements.push({
      kind: 'building',
      typeId: hit.typeId,
      tribe: hit.tribeId,
      x: half(b.hx),
      y: half(b.hy),
      ...(components.isValidPlayer(own) ? { owner: own } : {}),
    });
  }
  for (const h of entities.humans) {
    const jobType = jobByName.get(h.role);
    const tribe = tribeByName.get(h.tribe);
    if (jobType === undefined || tribe === undefined || !inBounds(h.hx, h.hy)) {
      skipped++;
      continue;
    }
    placements.push({
      kind: 'human',
      jobType,
      tribe,
      x: half(h.hx),
      y: half(h.hy),
      ...(components.isValidPlayer(h.player) ? { owner: h.player } : {}),
    });
  }
  return { placements, skipped };
}

/**
 * Build + run the slice sim for a map that carries AUTHORED entity placements (`map.cif`
 * `StaticObjects` → `maps/<id>.json` `entities`): every resolvable `sethouse` becomes a built
 * building and every `sethuman` a settler at its authored cell — replacing the synthetic
 * "first walkable cells" demo placement for such maps (docs/ROADMAP.md placement-import slice).
 *
 * The content set stays in the demo-content mold (passive typeId+id rows over the map's landscape
 * via {@link demoLandscape}) so the sim can host the real typeIds without pulling the full IR
 * through zod; homes get {@link AUTHORED_HOME_PIN}. Returns `null` when nothing resolves (the
 * caller falls back to {@link runSlice}) — the same graceful-degradation contract as the loaders
 * above. Deterministic: placements enqueue in file order, no RNG.
 */
export function runAuthoredSlice(
  seed: number,
  ticks: number,
  map: TerrainMap,
  entities: NonNullable<TerrainMapFile['entities']>,
  rows: AuthoredJoinRows,
): Simulation | null {
  const { placements, skipped } = resolveAuthoredPlacements(entities, rows, map);
  if (placements.length === 0) return null;
  if (skipped > 0 || entities.animals.length > 0) {
    console.warn(
      `runAuthoredSlice: placed ${placements.length}, skipped ${skipped} unresolvable/out-of-bounds, deferred ${entities.animals.length} animals`,
    );
  }

  const buildingDefById = new Map<number, { id: string; kind: string }>();
  for (const b of rows.buildings ?? []) {
    if (b.typeId !== undefined && b.id !== undefined)
      buildingDefById.set(b.typeId, { id: b.id, kind: b.kind ?? 'workplace' });
  }
  const usedBuildings = [
    ...new Set(placements.filter((p) => p.kind === 'building').map((p) => p.typeId)),
  ].sort((a, b) => a - b);
  const usedJobs = [...new Set(placements.filter((p) => p.kind === 'human').map((p) => p.jobType))].sort(
    (a, b) => a - b,
  );
  const usedTribes = [...new Set(placements.map((p) => p.tribe))].sort((a, b) => a - b);
  const content = parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'vinland-authored-slice' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      ...usedJobs.filter((t) => t !== 0).map((typeId) => ({ typeId, id: `job_${typeId}` })),
    ],
    buildings: usedBuildings.map((typeId) => {
      const def = buildingDefById.get(typeId);
      return {
        typeId,
        id: def?.id ?? `building_${typeId}`,
        ...(def?.kind !== undefined ? { kind: def.kind } : {}),
        ...(def?.kind === 'home' ? { construction: AUTHORED_HOME_PIN } : {}),
      };
    }),
    landscape: demoLandscape(map),
    tribes: usedTribes.map((typeId) => ({ typeId, id: `tribe_${typeId}` })),
  });

  const sim = new Simulation({ seed, content, map });
  for (const p of placements) {
    if (p.kind === 'building') {
      sim.enqueue({
        kind: 'placeBuilding',
        buildingType: p.typeId,
        x: p.x,
        y: p.y,
        tribe: p.tribe,
        ...(p.owner !== undefined ? { owner: p.owner } : {}),
      });
    } else {
      sim.enqueue({
        kind: 'spawnSettler',
        jobType: p.jobType,
        x: p.x,
        y: p.y,
        tribe: p.tribe,
        ...(p.owner !== undefined ? { owner: p.owner } : {}),
      });
    }
  }
  sim.run(ticks);
  return sim;
}
