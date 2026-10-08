import {
  type FootprintCell,
  footprintCellDx,
  fullStateBlockAreaCells,
  GROUND_LAND,
  GROUND_VOID,
  GROUND_WATER,
  type GroundKind,
  type GroundLattice,
  groundLattice,
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
 * The ground also yields the land vertex mask: a node every touching triangle of which is an `isWater`
 * row is sea, everything else is land, so an impassable rock face or the border stays land and only the
 * sea is water to a ship (`TerrainGraph.isWater`) and to a land-only vertex tint. It yields the edges a
 * walker or a ship may step along as well, the original's `lmtw` lane replayed.
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
        readonly isWater?: boolean | undefined;
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

/** The ground logicType of the map frame and void filler, the one with no `trianglepatterntypes` row. */
const BORDER_LOGIC_TYPE = 0;
/** A node's edge mask with no direction open. */
const NO_EDGES = 0;

/** logicType → terrain class from the extracted `trianglepatterntypes.cif` flags. */
function groundClassTable(ir: CollisionIrView): ReadonlyMap<number, number> {
  const table = new Map<number, number>();
  table.set(BORDER_LOGIC_TYPE, TERRAIN_IMPASSABLE); // the one logicType with no row (named approximation)
  for (const t of ir.trianglePatternTypes ?? []) {
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

/** `EditName` → footprint for every object that blocks something. */
function objectFootprints(
  rows: NonNullable<CollisionIrView['landscapeGfx']>,
): ReadonlyMap<string, ObjectFootprint> {
  const key = (c: Readonly<FootprintCell>): string => `${c.dx},${c.dy}`;
  const out = new Map<string, ObjectFootprint>();
  for (const g of rows) {
    if (g.editName === undefined) continue;
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
 * builds or sows only on the worse of the two. Walking is then settled per node by {@link mapGroundLattice};
 * building and sowing stay at cell resolution, where the original's per-node rule is not verified.
 */
function joinTriangleClasses(a: number, b: number): number {
  if (a === TERRAIN_IMPASSABLE && b === TERRAIN_IMPASSABLE) return TERRAIN_IMPASSABLE;
  if (a === TERRAIN_IMPASSABLE || b === TERRAIN_IMPASSABLE) return TERRAIN_MARGIN;
  if (a === TERRAIN_MARGIN || b === TERRAIN_MARGIN) return TERRAIN_MARGIN;
  if (a === TERRAIN_BARREN || b === TERRAIN_BARREN) return TERRAIN_BARREN;
  return TERRAIN_OPEN;
}

/**
 * The map's ground lattice by the original's rule (`groundLattice`): each triangle's kind from its
 * pattern, land a row with `humancanwalkon`, water the `iswater` row, void the rest and the row-less
 * border; a pattern the content does not resolve counts as land, as the ground classes treat it.
 * Undefined without a ground lane.
 */
function mapGroundLattice(map: TerrainMapFile, ir: CollisionIrView): GroundLattice | undefined {
  const ground = map.ground;
  if (ground === undefined) return undefined;
  const rows = new Map((ir.trianglePatternTypes ?? []).map((t) => [t.type, t]));
  const logicTypeByName = new Map((ir.gfxPatterns ?? []).map((p) => [p.editName, p.logicType]));
  const kindOfPattern = ground.patterns.map((name): GroundKind => {
    const logicType = logicTypeByName.get(name);
    if (logicType === undefined) return GROUND_LAND;
    if (logicType === BORDER_LOGIC_TYPE) return GROUND_VOID;
    const row = rows.get(logicType);
    if (row === undefined || row.humanCanWalkOn === true) return GROUND_LAND;
    return row.isWater === true ? GROUND_WATER : GROUND_VOID;
  });
  const kindOf = (dictIndex: number): GroundKind => kindOfPattern[dictIndex] ?? GROUND_LAND;
  return groundLattice(map.width, map.height, ground.a.map(kindOf), ground.b.map(kindOf));
}

/**
 * Resolve a decoded map's collision grid at half-cell resolution (the sim's `2W×2H` navigation lattice).
 * Ground walks and floods per node and is stepped along the original's edges ({@link mapGroundLattice});
 * its build and sow classes are per-cell in the source (`empa`/`empb` triangles) and stamp their 2×2
 * node block. Object block areas are stamped at their native half-cell anchors and offsets.
 */
export function buildCollisionTerrain(map: TerrainMapFile, ir: CollisionIrView): TerrainMap {
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
  const typeIds = upsampled.typeIds.slice(); // a mutable copy the ground and object stamps write into
  const lattice = mapGroundLattice(map, ir);
  if (lattice !== undefined) {
    for (let i = 0; i < typeIds.length; i++) {
      // Land no edge leaves, the map frame's, is as closed to a walker as rock.
      if (lattice.kinds[i] !== GROUND_LAND || lattice.edges[i] === NO_EDGES) typeIds[i] = TERRAIN_IMPASSABLE;
      else if (typeIds[i] === TERRAIN_IMPASSABLE) typeIds[i] = TERRAIN_MARGIN; // walks, builds nothing
    }
  }

  if (map.objects !== undefined && ir.landscapeGfx !== undefined) {
    const gfxByName = objectFootprints(ir.landscapeGfx);
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

  const landVertices =
    lattice === undefined ? undefined : Array.from(lattice.kinds, (k) => k !== GROUND_WATER);
  return {
    resolution: 'half-cell',
    width: nodeW,
    height: nodeH,
    typeIds,
    ...(map.elevation !== undefined ? { elevation: map.elevation } : {}),
    ...(map.tints !== undefined ? { tints: map.tints } : {}),
    ...(landVertices === undefined ? {} : { landVertices }),
    ...(lattice === undefined ? {} : { groundEdges: lattice.edges }),
    ...(map.continents !== undefined ? { waterContinents: map.continents } : {}),
    ...(map.roughness !== undefined ? { roughness: map.roughness } : {}),
    ...(map.fishSwarms !== undefined ? { fishSwarms: map.fishSwarms } : {}),
  };
}
