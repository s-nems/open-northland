import { fullStateBlockAreaCells, type LandscapeBlockArea, type TerrainMapFile } from '@open-northland/data';
import { halfCellMapFromCells, type TerrainMap } from '@open-northland/sim';
import {
  TERRAIN_BARREN,
  TERRAIN_BLOCKED,
  TERRAIN_IMPASSABLE,
  TERRAIN_MARGIN,
  TERRAIN_OPEN,
} from '../catalog/terrain.js';

/**
 * The decoded-map → sim COLLISION join: resolve a real map's grid into the four SEMANTIC terrain
 * classes the sim's walk/build flags are keyed to (`catalog/terrain.ts`), from the same extracted
 * data the original engine blocks by:
 *
 *  - **ground**: each cell's two triangle patterns join `gfxPatterns` by name → `logicType` →
 *    the `trianglepatterntypes.cif` row (`trianglePatternTypes` in the IR), whose real
 *    `humancanwalkon` / `housecanbebuildon` flags class the ground — water and swamp block both,
 *    mountain faces and snow are walkable but reject building (they land on `TERRAIN_MARGIN`),
 *    every fully-flagged land class is open. The one gap in the data is the `border` pattern
 *    (logicType 0, no table row): classed impassable — a named approximation (the map frame band is
 *    visually outside the playfield in the original). A cell takes its WORST triangle's class
 *    (conservative: a half-water cell rejects a building wall). When an older `ir.json` carries no
 *    `trianglePatternTypes` lane, the split degrades to a pinned approximation of the same table.
 *  - **objects**: each placed landscape object (tree/rock/deposit/palisade…) joins `landscapeGfx` by
 *    `EditName` and stamps its `LogicWalkBlockArea` cells as its BODY (neither walk nor build) and
 *    its `LogicBuildBlockArea`-only cells as its MARGIN — the per-object blocking the original's
 *    placement + routing read. The FULL state's areas apply regardless of the placement's level
 *    (`fullStateBlockAreaCells` — the same conservative stance as the sim's resource footprints).
 *    **Except the harvestables** (`skipObjectNames` — trees/ore/stone that `spawnMapResources` turns
 *    into real `Resource` entities): those must NOT be baked into the STATIC grid, because their
 *    blocking has to VANISH when the node is felled/depleted — it lives exclusively in the sim's
 *    dynamic resource-footprint overlay (stamped at spawn, unstamped at removal). Baking them
 *    statically left a felled tree's cell walled off forever, so the collector could never path to
 *    the trunk it had just dropped there ("kłoda leży, zbieracz stoi") — the double-blocking bug.
 *    A skipped placement's collision is then the sim-content footprint (own-node), a named
 *    approximation of the IR area until real per-variant footprints enter the sim's content set.
 *
 * The raw per-cell `typeIds` lane is NOT consulted: it is the object lane collapsed per cell (its
 * dominant value, 1 = "void", is plain ground), so the object join above is its authoritative,
 * area-accurate source.
 *
 * Pure and synchronous — unit-testable against synthetic fixtures; the `?map=` entry calls it once at
 * load. Missing lanes degrade: no ground lane → no ground blocking, no objects lane (or no IR rows)
 * → no object blocking; a map with neither comes back all-open (never a crash).
 */

/** The two IR lanes the join reads — a structural view (`ContentIr` satisfies it), so the pure
 *  function is unit-testable against tiny synthetic fixtures instead of full schema rows. */
export interface CollisionIrView {
  readonly gfxPatterns?:
    | readonly { readonly editName?: string | undefined; readonly logicType: number }[]
    | undefined;
  readonly trianglePatternTypes?:
    | readonly {
        readonly type: number;
        readonly humanCanWalkOn?: boolean | undefined;
        readonly houseCanBeBuildOn?: boolean | undefined;
        readonly bioCanPlantOn?: boolean | undefined;
      }[]
    | undefined;
  readonly landscapeGfx?:
    | readonly {
        readonly editName?: string | undefined;
        readonly walkBlockAreas?: readonly Readonly<LandscapeBlockArea>[] | undefined;
        readonly buildBlockAreas?: readonly Readonly<LandscapeBlockArea>[] | undefined;
      }[]
    | undefined;
}

/**
 * Fallback ground split for an `ir.json` generated before the `trianglePatternTypes` lane existed —
 * a pinned approximation of that table's real flags (water 1 and swamp 5 block both; mountain 3 and
 * snow 7 walk but reject building; sand 4, beach 8 and desert stone 9 walk+build but grow nothing;
 * border 0 and the void filler 6 are impassable).
 */
const FALLBACK_GROUND_CLASS: ReadonlyMap<number, number> = new Map([
  [0, TERRAIN_IMPASSABLE], // border — no table row even in the real data
  [1, TERRAIN_IMPASSABLE], // water
  [3, TERRAIN_MARGIN], // mountain faces — humancanwalkon 1, no housecanbebuildon
  [4, TERRAIN_BARREN], // sand — walk + build, no biocanplanton
  [5, TERRAIN_IMPASSABLE], // swamp — neither flag
  [6, TERRAIN_IMPASSABLE], // black — the void filler outside authored ground
  [7, TERRAIN_MARGIN], // snow — walkable, not buildable
  [8, TERRAIN_BARREN], // beach — like sand
  [9, TERRAIN_BARREN], // desert stone — like sand
]);

/** logicType → terrain class from the extracted `trianglepatterntypes.cif` flags (see module doc). */
function groundClassTable(ir: CollisionIrView): ReadonlyMap<number, number> {
  const rows = ir.trianglePatternTypes;
  if (rows === undefined || rows.length === 0) return FALLBACK_GROUND_CLASS;
  const table = new Map<number, number>();
  table.set(0, TERRAIN_IMPASSABLE); // border: the one logicType with no row (named approximation)
  for (const t of rows) {
    if (t.humanCanWalkOn !== true) table.set(t.type, TERRAIN_IMPASSABLE);
    else if (t.houseCanBeBuildOn !== true) table.set(t.type, TERRAIN_MARGIN);
    // Walk + build but no `biocanplanton` (sand/beach/desert stone) → open-but-barren: everything
    // works there except the plough (the farmer drive's grass-only field gate).
    else if (t.bioCanPlantOn !== true) table.set(t.type, TERRAIN_BARREN);
    // walk + build + plant → open: no entry (the grid default).
  }
  return table;
}

/** The worse of two ground classes (impassable > margin > barren > open) — a cell takes its worst
 *  triangle, so a half-sand cell rejects the plough like it rejects nothing else. */
function worseGroundClass(a: number, b: number): number {
  if (a === TERRAIN_IMPASSABLE || b === TERRAIN_IMPASSABLE) return TERRAIN_IMPASSABLE;
  if (a === TERRAIN_MARGIN || b === TERRAIN_MARGIN) return TERRAIN_MARGIN;
  if (a === TERRAIN_BARREN || b === TERRAIN_BARREN) return TERRAIN_BARREN;
  return TERRAIN_OPEN;
}

/**
 * Resolve a decoded map's collision grid at HALF-CELL resolution (the sim's `2W×2H` navigation
 * lattice): every node classed as `TERRAIN_OPEN` / `TERRAIN_IMPASSABLE` / `TERRAIN_BLOCKED` /
 * `TERRAIN_MARGIN`. Ground classes are per-cell in the source (`empa`/`empb` triangles) and stamp
 * their 2×2 node block; object block areas are stamped at their native half-cell anchors and
 * offsets (the `emla`/`lmlt` lanes' own resolution). Feed THIS to the sim (nav + placement); the
 * raw map keeps driving the render layers (ground mesh, decor, ambience).
 */
export function buildCollisionTerrain(
  map: TerrainMapFile,
  ir: CollisionIrView,
  skipObjectNames?: ReadonlySet<string>,
): TerrainMap {
  const { width, height } = map;

  // --- ground: class each CELL by its two triangles' extracted walk/build flags, then upsample ----
  // (A per-triangle split below cell resolution has no pinned mapping, so ground classes are
  // per-cell; `halfCellMapFromCells` owns the cell → 2×2-node-block convention.)
  const cellClasses = new Array<number>(width * height).fill(TERRAIN_OPEN);
  if (map.ground !== undefined && ir.gfxPatterns !== undefined) {
    const classTable = groundClassTable(ir);
    const logicTypeByName = new Map<string, number>();
    for (const p of ir.gfxPatterns) {
      if (p.editName !== undefined) logicTypeByName.set(p.editName, p.logicType);
    }
    const classOf = (dictIndex: number | undefined): number => {
      if (dictIndex === undefined) return TERRAIN_OPEN;
      const name = map.ground?.patterns[dictIndex];
      if (name === undefined) return TERRAIN_OPEN;
      const logicType = logicTypeByName.get(name);
      if (logicType === undefined) return TERRAIN_OPEN;
      return classTable.get(logicType) ?? TERRAIN_OPEN;
    };
    for (let i = 0; i < width * height; i++) {
      cellClasses[i] = worseGroundClass(classOf(map.ground.a[i]), classOf(map.ground.b[i]));
    }
  }
  const upsampled = halfCellMapFromCells({ width, height, typeIds: cellClasses });
  const nodeW = upsampled.width;
  const nodeH = upsampled.height;
  const typeIds = upsampled.typeIds.slice(); // a mutable copy the object stamps write into

  // --- objects: each placement's walk-block body + build-block margin -------------------------------
  if (map.objects !== undefined && ir.landscapeGfx !== undefined) {
    const gfxByName = new Map<string, { walk: [number, number][]; margin: [number, number][] }>();
    for (const g of ir.landscapeGfx) {
      if (g.editName === undefined) continue;
      // A harvestable that spawns as a sim Resource blocks through the DYNAMIC footprint overlay
      // only (unstamped when felled/depleted) — never baked into this static grid (module doc).
      if (skipObjectNames?.has(g.editName)) continue;
      const walk = fullStateBlockAreaCells(g.walkBlockAreas).map((c): [number, number] => [c.dx, c.dy]);
      const build = fullStateBlockAreaCells(g.buildBlockAreas).map((c): [number, number] => [c.dx, c.dy]);
      if (walk.length === 0 && build.length === 0) continue; // pure decor (flowers, waves) never blocks
      const walkKeys = new Set(walk.map(([dx, dy]) => `${dx},${dy}`));
      gfxByName.set(g.editName, {
        walk,
        margin: build.filter(([dx, dy]) => !walkKeys.has(`${dx},${dy}`)),
      });
    }
    const stamp = (cx: number, cy: number, cls: number): void => {
      if (cx < 0 || cy < 0 || cx >= nodeW || cy >= nodeH) return;
      const i = cy * nodeW + cx;
      const current = typeIds[i];
      // Severity order: body > impassable ground > margin > barren > open. A margin never downgrades
      // a cell — but it does OVERRIDE barren (an object's build ring blocks building on sand too).
      if (cls === TERRAIN_BLOCKED) typeIds[i] = TERRAIN_BLOCKED;
      else if (current === TERRAIN_OPEN || current === TERRAIN_BARREN) typeIds[i] = cls;
    };
    const { types, placements } = map.objects;
    for (let i = 0; i + 2 < placements.length; i += 3) {
      const hx = placements[i];
      const hy = placements[i + 1];
      const typeIndex = placements[i + 2];
      if (hx === undefined || hy === undefined || typeIndex === undefined) break;
      const name = types[typeIndex];
      const gfx = name !== undefined ? gfxByName.get(name) : undefined;
      if (gfx === undefined) continue;
      // Anchor the object's block-area offsets on its half-cell VERBATIM: the `emla` placement,
      // the `lmlt` blocking lane, and the `LogicWalkBlockArea` offsets all live on the same 2W×2H
      // grid (source basis: mapdat lane layout), so no flooring — the old cell-floor skew is gone.
      for (const [dx, dy] of gfx.walk) stamp(hx + dx, hy + dy, TERRAIN_BLOCKED);
      for (const [dx, dy] of gfx.margin) stamp(hx + dx, hy + dy, TERRAIN_MARGIN);
    }
  }

  return { resolution: 'half-cell', width: nodeW, height: nodeH, typeIds };
}
