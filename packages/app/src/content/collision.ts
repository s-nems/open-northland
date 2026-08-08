import {
  type FootprintCell,
  footprintCellDx,
  fullStateBlockAreaCells,
  type LandscapeBlockArea,
  type TerrainMapFile,
} from '@open-northland/data';
import { halfCellMapFromCells, type TerrainMap } from '@open-northland/sim';
import {
  TERRAIN_BARREN,
  TERRAIN_BLOCKED,
  TERRAIN_IMPASSABLE,
  TERRAIN_MARGIN,
  TERRAIN_OPEN,
} from '../catalog/terrain.js';
import { forEachPlacement } from './map-placements.js';

/**
 * The decoded-map → sim collision join: resolve a real map's grid into the semantic terrain classes of
 * `catalog/terrain.ts`. Ground comes from each cell's two triangle patterns, joined `gfxPatterns` by name
 * → `logicType` → the `trianglepatterntypes.cif` row whose real `humancanwalkon` / `housecanbebuildon`
 * flags class it. Objects come from each placement's `LogicWalkBlockArea` cells (body) and its
 * `LogicBuildBlockArea`-only cells (margin), at the full state's areas whatever the placement's level.
 *
 * The raw per-cell `typeIds` lane is not consulted: it is the object lane collapsed per cell (its dominant
 * value, 1 = "void", is plain ground), so the object join is the authoritative, area-accurate source.
 *
 * Missing lanes degrade, so a map with neither ground nor objects comes back all-open.
 */

/** A structural view of the IR lanes the join reads (`ContentIr` satisfies it), so the join is testable
 *  against tiny synthetic fixtures instead of full schema rows. */
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
        readonly editGroups?: readonly string[] | undefined;
        readonly walkBlockAreas?: readonly Readonly<LandscapeBlockArea>[] | undefined;
        readonly buildBlockAreas?: readonly Readonly<LandscapeBlockArea>[] | undefined;
      }[]
    | undefined;
}

/**
 * Fallback ground split for an `ir.json` generated before the `trianglePatternTypes` lane existed: a
 * pinned approximation of that table's real flags.
 */
const FALLBACK_GROUND_CLASS: ReadonlyMap<number, number> = new Map([
  [0, TERRAIN_IMPASSABLE], // border - no table row even in the real data
  [1, TERRAIN_IMPASSABLE], // water
  [3, TERRAIN_MARGIN], // mountain faces - humancanwalkon 1, no housecanbebuildon
  [4, TERRAIN_BARREN], // sand - walk + build, no biocanplanton
  [5, TERRAIN_IMPASSABLE], // swamp - neither flag
  [6, TERRAIN_IMPASSABLE], // black - the void filler outside authored ground
  [7, TERRAIN_MARGIN], // snow - walkable, not buildable
  [8, TERRAIN_BARREN], // beach - like sand
  [9, TERRAIN_BARREN], // desert stone - like sand
]);

/** logicType → terrain class from the extracted `trianglepatterntypes.cif` flags. */
function groundClassTable(ir: CollisionIrView): ReadonlyMap<number, number> {
  const rows = ir.trianglePatternTypes;
  if (rows === undefined || rows.length === 0) return FALLBACK_GROUND_CLASS;
  const table = new Map<number, number>();
  table.set(0, TERRAIN_IMPASSABLE); // border: the one logicType with no row (named approximation)
  for (const t of rows) {
    if (t.humanCanWalkOn !== true) table.set(t.type, TERRAIN_IMPASSABLE);
    else if (t.houseCanBeBuildOn !== true) table.set(t.type, TERRAIN_MARGIN);
    // Walk + build but no `biocanplanton`: everything works there except the plough.
    else if (t.bioCanPlantOn !== true) table.set(t.type, TERRAIN_BARREN);
    // walk + build + plant → open: no entry (the grid default).
  }
  return table;
}

/** One object's blocking cells: `body` blocks walking and building, `margin` blocks building alone. */
interface ObjectFootprint {
  readonly body: readonly Readonly<FootprintCell>[];
  readonly margin: readonly Readonly<FootprintCell>[];
}

/** `EditName` → footprint for every object that blocks something; `skipObjectNames` are left out. */
function objectFootprints(
  rows: NonNullable<CollisionIrView['landscapeGfx']>,
  skipObjectNames?: ReadonlySet<string>,
): ReadonlyMap<string, ObjectFootprint> {
  const key = (c: Readonly<FootprintCell>): string => `${c.dx},${c.dy}`;
  const out = new Map<string, ObjectFootprint>();
  for (const g of rows) {
    if (g.editName === undefined || skipObjectNames?.has(g.editName)) continue;
    const body = fullStateBlockAreaCells(g.walkBlockAreas);
    const build = fullStateBlockAreaCells(g.buildBlockAreas);
    if (body.length === 0 && build.length === 0) continue; // pure decor (flowers, waves) never blocks
    // The build area minus the body: the two areas overlap, and a body cell must not be downgraded.
    const claimed = new Set(body.map(key));
    const margin: FootprintCell[] = [];
    for (const cell of build) {
      const k = key(cell);
      if (claimed.has(k)) continue;
      claimed.add(k);
      margin.push(cell);
    }
    out.set(g.editName, { body, margin });
  }
  return out;
}

/**
 * The two triangle classes joined into the cell's class: it walks unless both triangles refuse, and
 * builds or sows only on the worse of the two.
 *
 * Cell-resolution approximation of the original's per-node rule (`docs/formats/MAPDAT.md`): a walkable
 * triangle opens all four of the cell's nodes here, only the nodes it touches there.
 */
function joinTriangleClasses(a: number, b: number): number {
  if (a === TERRAIN_IMPASSABLE && b === TERRAIN_IMPASSABLE) return TERRAIN_IMPASSABLE;
  if (a === TERRAIN_IMPASSABLE || b === TERRAIN_IMPASSABLE) return TERRAIN_MARGIN;
  if (a === TERRAIN_MARGIN || b === TERRAIN_MARGIN) return TERRAIN_MARGIN;
  if (a === TERRAIN_BARREN || b === TERRAIN_BARREN) return TERRAIN_BARREN;
  return TERRAIN_OPEN;
}

/**
 * Resolve a decoded map's collision grid at half-cell resolution (the sim's `2W×2H` navigation lattice).
 * Ground classes are per-cell in the source (`empa`/`empb` triangles) and stamp their 2×2 node block;
 * object block areas are stamped at their native half-cell anchors and offsets.
 */
export function buildCollisionTerrain(
  map: TerrainMapFile,
  ir: CollisionIrView,
  skipObjectNames?: ReadonlySet<string>,
): TerrainMap {
  const { width, height } = map;

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
      cellClasses[i] = joinTriangleClasses(classOf(map.ground.a[i]), classOf(map.ground.b[i]));
    }
  }
  const upsampled = halfCellMapFromCells({ width, height, typeIds: cellClasses });
  const nodeW = upsampled.width;
  const nodeH = upsampled.height;
  const typeIds = upsampled.typeIds.slice(); // a mutable copy the object stamps write into

  if (map.objects !== undefined && ir.landscapeGfx !== undefined) {
    const gfxByName = objectFootprints(ir.landscapeGfx, skipObjectNames);
    const stamp = (cx: number, cy: number, cls: number): void => {
      if (cx < 0 || cy < 0 || cx >= nodeW || cy >= nodeH) return;
      const i = cy * nodeW + cx;
      const current = typeIds[i];
      // Severity order: body > impassable ground > margin > barren > open. A margin never downgrades
      // a cell - but it does override barren (an object's build ring blocks building on sand too).
      if (cls === TERRAIN_BLOCKED) typeIds[i] = TERRAIN_BLOCKED;
      else if (current === TERRAIN_OPEN || current === TERRAIN_BARREN) typeIds[i] = cls;
    };
    const { types, placements } = map.objects;
    forEachPlacement(placements, (hx, hy, typeIndex) => {
      const name = types[typeIndex];
      const gfx = name !== undefined ? gfxByName.get(name) : undefined;
      if (gfx === undefined) return;
      // The `emla` placement, the `lmlt` blocking lane and the `LogicWalkBlockArea` offsets all live on
      // the same 2W×2H grid (source basis: mapdat lane layout), stamped with the odd-row parity shift.
      for (const c of gfx.body) stamp(hx + footprintCellDx(hy, c), hy + c.dy, TERRAIN_BLOCKED);
      for (const c of gfx.margin) stamp(hx + footprintCellDx(hy, c), hy + c.dy, TERRAIN_MARGIN);
    });
  }

  return { resolution: 'half-cell', width: nodeW, height: nodeH, typeIds };
}
