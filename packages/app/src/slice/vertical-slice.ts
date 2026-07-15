import type { BuildingFootprint, TerrainMapFile } from '@open-northland/data';
import { type SceneTerrain, terrainMapToScene } from '@open-northland/render';
import {
  type CellTerrainMap,
  components,
  halfCellMapFromCells,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '@open-northland/sim';
import { HARVEST_ATOMIC } from '../catalog/atomics.js';
import { GRASS } from '../catalog/buildings.js';
import { PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_JOINERY,
  GOOD_WOOD,
  JOB_CARRIER,
  JOB_COLLECTOR,
  sandboxContent,
  sandboxWalkableTypeIds,
  weaponEquipmentFor,
} from '../game/sandbox/index.js';
import {
  type AuthoredJoinRows,
  type AuthoredPlacement,
  resolveAuthoredPlacements,
} from './authored-placements.js';

/**
 * The vertical-slice scenario, built deterministically so a screenshot frame is reproducible.
 *
 * This mirrors the world the render scene integration test exercises (a 6×1 grass strip: HQ +
 * joinery placed via commands, a wood gatherer + a carrier, two wood nodes), so the headless shot entry
 * draws the exact frame the unit tests already assert the draw list of.
 *
 * The content comes from the global sandbox fixture (`game/sandbox/`), the same ruleset used by
 * acceptance scenes. This module chooses only placement cells for the tiny shot/live fallback; the
 * decoded-map fetch lives in `./map-loader.ts` and the pure authored-entity join in
 * `./authored-placements.ts`.
 */

const { Position, Resource } = components;

const WIDTH = 6;
const HEIGHT = 1;

/** The fixed placement nodes on the synthetic 6×1 strip — each cell's anchor node (row 0: node
 *  (2x, 0)): [HQ, joinery, wood gatherer, carrier, tree, tree]. */
const STRIP_CELLS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 10, y: 0 },
  { x: 8, y: 0 },
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 4, y: 0 },
  { x: 6, y: 0 },
];

/** The synthetic strip in its authored cell shape (the render fallback projects this directly). */
function grassCells(): CellTerrainMap {
  return { width: WIDTH, height: HEIGHT, typeIds: new Array(WIDTH * HEIGHT).fill(GRASS) };
}

function grassMap(): TerrainMap {
  return halfCellMapFromCells(grassCells());
}

/**
 * The terrain grid the scene layer projects, derived from the same {@link TerrainMap} the sim
 * navigates via the render package's `terrainMapToScene` seam — so the demo exercises the exact
 * map→scene path a loaded `content/maps/<id>.json` takes, not a hand-duplicated grid.
 *
 * When a `map` is passed (loaded from disk via `loadTerrainMap`), its varied landscape typeIds
 * carry through; otherwise the synthetic grass strip is projected — the reproducible default for
 * `npm run shot` + the unit tests, which must not depend on the gitignored `content/`.
 */
export function sliceTerrain(map?: CellTerrainMap | TerrainMapFile): SceneTerrain {
  return terrainMapToScene(map ?? grassCells());
}

/** The six placement slots the slice needs: HQ, joinery, wood gatherer, carrier, and two wood nodes. */
const PLACEMENT_CELL_COUNT = 6;

/**
 * The first `count` walkable half-cell nodes of `map`, in canonical row-major id order, as integer
 * `(x, y)` node coords — or `null` if the map has fewer than `count` walkable nodes. "Walkable" is resolved
 * from the global sandbox landscape table (the same `walkable` flag `buildTerrainGraph` reads), so
 * the slice's entities land only on cells the sim can stand on — placing a building on water would
 * make the gatherer's path unreachable. Deterministic: a fixed scan order, no RNG.
 *
 * Some real grids are ~all water under the sandbox's base table (e.g. a coastal scenario whose land is
 * all typeId 1), so the `null` return lets `runSlice` fall back to the synthetic strip rather than crash.
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
 * Enqueue resolved placements in order — the one spot the `placeBuilding`/`spawnSettler` command
 * shapes are written, shared by the demo strip and the authored import (list order = enqueue order,
 * so determinism follows the placement list). Buildings are forced: both callers place fixture state
 * (a decoded map's authored houses, the pinned demo world) which loads as-is, exactly as the original
 * loads a scenario map — the tech/collision gates govern the player's interactive placements.
 */
function enqueuePlacements(sim: Simulation, placements: readonly AuthoredPlacement[]): void {
  for (const p of placements) {
    const own = p.owner !== undefined ? { owner: p.owner } : {};
    if (p.kind === 'building') {
      sim.enqueue({
        kind: 'placeBuilding',
        buildingType: p.typeId,
        x: p.x,
        y: p.y,
        tribe: p.tribe,
        force: true,
        ...own,
      });
    } else {
      // A warrior placement (scene author or imported-map `sethuman`) carries its class weapon in the
      // equipment slot, so an existing soldier's Broń row + drawn weapon match — like an admin spawn.
      const equipment = weaponEquipmentFor(p.jobType);
      sim.enqueue({
        kind: 'spawnSettler',
        jobType: p.jobType,
        x: p.x,
        y: p.y,
        tribe: p.tribe,
        ...own,
        ...(equipment !== undefined ? { equipment } : {}),
      });
    }
  }
}

/**
 * The first anchor (row-major scan) where `typeId`'s footprint fits against the sim's live placement
 * rule (`Simulation.placementProbe` — the exact gate an interactive click goes through), or `null`
 * when nothing on the map fits (a dense map degrades to the walkable-cell fallback). Deterministic:
 * a fixed scan order over the current world state.
 */
function firstPlaceableCell(
  sim: Simulation,
  typeId: number,
  map: TerrainMap,
): { x: number; y: number } | null {
  const probe = sim.placementProbe(typeId);
  if (probe === null) return null;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (probe.canPlace(x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Build the vertical-slice simulation (seed-fixed) and run it `ticks` ticks deterministically. The
 * returned sim is at a tick boundary, ready for `snapshot()` → `buildScene` → the renderer. No RAF,
 * no wall-clock: this is the "render scenario X at seed S, step N ticks" entry the harness needs.
 *
 * Without a `map` the slice runs on the synthetic 6×1 grass strip (the reproducible default the shot
 * PNG depends on). With a loaded grid (the `?map=` entry passes the collision-resolved terrain — see
 * `content/collision.ts`), the same six entities (HQ, joinery, wood gatherer, carrier, two wood
 * nodes) land on the real grid instead of the hardcoded strip: the two buildings on the first anchors
 * their footprints actually fit ({@link firstPlaceableCell}, stepping one tick between them so the
 * second sees the first), settlers + trees on the first walkable cells. A loaded map with too few
 * walkable cells falls back to the strip, so the slice always runs and never throws.
 */
export function runSlice(
  seed: number,
  ticks: number,
  map?: TerrainMap,
  owner?: number,
  footprints?: ReadonlyMap<number, BuildingFootprint>,
  goodNames?: ReadonlyMap<string, string>,
): Simulation {
  // Resolve placement first: a usable map yields its first six walkable cells; no map (or a map with
  // too few walkable cells) falls back to the synthetic strip — content + terrain + cells all revert
  // together, so the fallback world matches the no-map slice (exactly, when the caller also passed no
  // `footprints`; a real-content caller's fallback carries them, differing only in inert content rows —
  // fixtures force-place, so nothing behavioral changes).
  const mapCells = map ? walkableCells(map, sandboxWalkableTypeIds(map), PLACEMENT_CELL_COUNT) : null;
  const usable = map !== undefined && mapCells !== null;
  // `footprints` (the live real-content entry passes them, from ir.json) replace the catalog's
  // hand-authored approximations with the buildings' real collision bodies (see SandboxContentExtras).
  const content = sandboxContent(usable ? map : undefined, {
    ...(footprints ? { buildingFootprints: footprints } : {}),
    ...(goodNames ? { goodNames } : {}),
  });
  const terrain = usable ? map : grassMap();
  const cells = mapCells ?? STRIP_CELLS;
  const sim = new Simulation({ seed, content, map: terrain });

  const cellAt = (i: number): { x: number; y: number } => {
    const c = cells[i];
    if (c === undefined)
      throw new Error(`expected ${PLACEMENT_CELL_COUNT} placement cells, got ${cells.length}`);
    return c;
  };

  // `owner` (optional) tags the slice's buildings + settlers to a player so they're selectable/orderable
  // in the interactive live entry. Omitted (the shot/default path) leaves them neutral — hash untouched.
  const own = owner !== undefined ? { owner } : {};

  // Building cells: on a real map, prefer anchors where the footprint actually fits (clear ground, off
  // the water/forest — the probe applies the same rule the player's clicks go through), stepping one
  // tick between the two so the second probe sees the first house. The walkable-cell fallback (a dense
  // map where nothing fits, or the synthetic strip whose 6×1 grid can't host any footprint) force-places
  // like every fixture. The strip path takes the else-branch untouched — its pinned shot stays identical.
  if (usable) {
    const hq = firstPlaceableCell(sim, BUILDING_HEADQUARTERS, terrain) ?? cellAt(0);
    enqueuePlacements(sim, [
      { kind: 'building', typeId: BUILDING_HEADQUARTERS, tribe: PRIMARY_TRIBE, ...hq, ...own },
    ]);
    sim.run(1);
    const joinery = firstPlaceableCell(sim, BUILDING_JOINERY, terrain) ?? cellAt(1);
    enqueuePlacements(sim, [
      { kind: 'building', typeId: BUILDING_JOINERY, tribe: PRIMARY_TRIBE, ...joinery, ...own },
    ]);
    sim.run(1);
    enqueuePlacements(sim, [
      { kind: 'human', jobType: JOB_COLLECTOR, tribe: PRIMARY_TRIBE, ...cellAt(2), ...own },
      { kind: 'human', jobType: JOB_CARRIER, tribe: PRIMARY_TRIBE, ...cellAt(3), ...own },
    ]);
  } else {
    enqueuePlacements(sim, [
      { kind: 'building', typeId: BUILDING_HEADQUARTERS, tribe: PRIMARY_TRIBE, ...cellAt(0), ...own },
      { kind: 'building', typeId: BUILDING_JOINERY, tribe: PRIMARY_TRIBE, ...cellAt(1), ...own },
      { kind: 'human', jobType: JOB_COLLECTOR, tribe: PRIMARY_TRIBE, ...cellAt(2), ...own },
      { kind: 'human', jobType: JOB_CARRIER, tribe: PRIMARY_TRIBE, ...cellAt(3), ...own },
    ]);
  }
  // The strip's two demo wood nodes: bare 4-unit resources with no felling counter/footprint (the
  // committed shot PNG + the render integration test pin this minimal shape — `placeResourceNode` would
  // add both).
  for (const cell of [cellAt(4), cellAt(5)]) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(cell.x, cell.y));
    sim.world.add(tree, Resource, { goodType: GOOD_WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
  }
  sim.run(ticks);
  return sim;
}

/**
 * Build a sim on a real decoded map with no placed entities — the map viewer's default for an
 * imported map that carries no authored `StaticObjects`. The map's own trees/ore/stone still spawn as
 * harvestable nodes (the `?map=` entry's `spawnMapResources` runs after this); this exists purely so a
 * plain imported map does not get the synthetic HQ/joinery/gatherer/carrier demo cluster dropped onto
 * its first walkable cells. That demo world belongs only to the synthetic-strip fallback (no map) and
 * the deterministic shot PNG — both still go through {@link runSlice}.
 *
 * Deterministic: seed-fixed, no RNG, no placements. Uses the same global sandbox content + live
 * `footprints` a `runSlice` map path would, so a later interactive build behaves identically.
 */
export function runBareMap(
  seed: number,
  map: TerrainMap,
  footprints?: ReadonlyMap<number, BuildingFootprint>,
  goodNames?: ReadonlyMap<string, string>,
): Simulation {
  const content = sandboxContent(map, {
    ...(footprints ? { buildingFootprints: footprints } : {}),
    ...(goodNames ? { goodNames } : {}),
  });
  return new Simulation({ seed, content, map });
}

/**
 * Build + run the slice sim for a map that carries authored entity placements (`map.cif`
 * `StaticObjects` → `maps/<id>.json` `entities`): every resolvable `sethouse` becomes a built
 * building and every `sethuman` a settler at its authored cell — replacing the synthetic
 * "first walkable cells" demo placement for such maps.
 *
 * The content is the global sandbox content plus any extra authored type ids that are not in the sandbox
 * catalog yet, so authored maps do not shrink the build menu or profession rules. Returns `null` when
 * nothing resolves (the caller falls back to {@link runSlice}). Deterministic: placements enqueue in
 * file order, no RNG.
 */
export function runAuthoredSlice(
  seed: number,
  ticks: number,
  map: TerrainMap,
  entities: NonNullable<TerrainMapFile['entities']>,
  rows: AuthoredJoinRows,
  footprints?: ReadonlyMap<number, BuildingFootprint>,
  goodNames?: ReadonlyMap<string, string>,
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
  const content = sandboxContent(map, {
    jobs: usedJobs.filter((typeId) => typeId !== 0).map((typeId) => ({ typeId, id: `job_${typeId}` })),
    buildings: usedBuildings.map((typeId) => {
      const def = buildingDefById.get(typeId);
      return {
        typeId,
        id: def?.id ?? `building_${typeId}`,
        ...(def?.kind !== undefined ? { kind: def.kind } : {}),
      };
    }),
    tribes: usedTribes.map((typeId) => ({ typeId, id: `tribe_${typeId}` })),
    // Live real-content footprints (from ir.json), so authored + interactively-placed buildings collide.
    ...(footprints ? { buildingFootprints: footprints } : {}),
    ...(goodNames ? { goodNames } : {}),
  });

  const sim = new Simulation({ seed, content, map });
  enqueuePlacements(sim, placements);
  sim.run(ticks);
  return sim;
}
