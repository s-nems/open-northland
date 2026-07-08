import type { TerrainMapFile } from '@vinland/data';
import type { TerrainMap } from '@vinland/sim';
import { TERRAIN_BLOCKED, TERRAIN_MARGIN, TERRAIN_OPEN, TERRAIN_WATER } from '../game/sandbox/index.js';

/**
 * The decoded-map → sim COLLISION join: resolve a real map's raw landscape-lane grid into the four
 * SEMANTIC terrain classes the sim's walk/build flags are keyed to (`game/sandbox` `TERRAIN_*`), from
 * the same extracted data the original engine blocks by:
 *
 *  - **ground**: each cell's two triangle patterns join `gfxPatterns` by name → `logicType`. Water
 *    (1), the map border (0), mountain faces (3) and the void filler (6, "black") are unwalkable and
 *    unbuildable; every land class (meadow/mud/swamp/snow/beach/…) is open ground. A cell is blocked
 *    if EITHER of its triangles is (conservative: half-water cells reject a building wall).
 *  - **objects**: each placed landscape object (tree/rock/deposit/palisade…) joins `landscapeGfx` by
 *    `EditName` and stamps its `LogicWalkBlockArea` cells as its BODY (neither walk nor build) and its
 *    `LogicBuildBlockArea`-only cells as its MARGIN (walkable ground that rejects a building's
 *    reserved zone) — exactly the per-object blocking the original's placement + routing read. The
 *    FULL state's areas are used regardless of the placement's level (the same conservative stance as
 *    the sim's resource footprints: a sapling reserves its grown tree's space).
 *
 * The raw per-cell `typeIds` lane is NOT consulted: it is the object lane collapsed per cell (its
 * dominant value, 1 = "void", is plain ground), so the object join above is its authoritative,
 * area-accurate source. Approximated, source basis "Map collision": the CLASS split (which ground
 * logicTypes block) is our reading of the pattern tables — water/border/mountain/black are visually
 * and navigationally blocking in the original; no readable per-class flag exists to pin it.
 *
 * Pure and synchronous — unit-testable against synthetic fixtures; the `?map=` entry calls it once at
 * load. Missing lanes degrade: no ground lane → no water/border blocking, no objects lane (or no IR
 * rows) → no object blocking; a map with neither comes back all-open (never a crash).
 */

/** The two IR lanes the join reads — a structural view (`ContentIr` satisfies it), so the pure
 *  function is unit-testable against tiny synthetic fixtures instead of full schema rows. */
export interface CollisionIrView {
  readonly gfxPatterns?:
    | readonly { readonly editName?: string | undefined; readonly logicType: number }[]
    | undefined;
  readonly landscapeGfx?:
    | readonly {
        readonly editName?: string | undefined;
        readonly walkBlockAreas?: readonly (readonly number[])[] | undefined;
        readonly buildBlockAreas?: readonly (readonly number[])[] | undefined;
      }[]
    | undefined;
}

/** `gfxPatterns.logicType` classes that block (unwalkable + unbuildable) — see the module doc. */
const BLOCKING_GROUND_LOGIC_TYPES: ReadonlySet<number> = new Set([
  0, // border — the map-edge frame band
  1, // water
  3, // mountain faces
  6, // black — the void filler outside authored ground
]);

/**
 * Expand `Logic*BlockArea` rows (`[state, x, y, run]`) to the FULL state's cell offsets — the same
 * collapse the sim applies to a resource node's footprint (`footprint/resources.ts`): the largest
 * state index is the fresh/full object, and collision is conservatively static at that size.
 */
function fullStateOffsets(areas: readonly (readonly number[])[] | undefined): [number, number][] {
  if (areas === undefined || areas.length === 0) return [];
  let fullState = 0;
  for (const [state] of areas) if (state !== undefined && state > fullState) fullState = state;
  const out: [number, number][] = [];
  for (const [state, dx, dy, run] of areas) {
    if (state !== fullState || dx === undefined || dy === undefined || run === undefined) continue;
    for (let i = 0; i < run; i++) out.push([dx + i, dy]);
  }
  return out;
}

/**
 * Resolve a decoded map's collision grid: the same `{width, height, typeIds}` shape, with every cell
 * classed as `TERRAIN_OPEN` / `TERRAIN_WATER` / `TERRAIN_BLOCKED` / `TERRAIN_MARGIN`. Feed THIS to the
 * sim (nav + placement); the raw map keeps driving the render layers (ground mesh, decor, ambience).
 */
export function buildCollisionTerrain(map: TerrainMapFile, ir: CollisionIrView): TerrainMap {
  const { width, height } = map;
  const typeIds = new Array<number>(width * height).fill(TERRAIN_OPEN);

  // --- ground: water / border / mountain / void-filler triangles block the cell ---------------------
  if (map.ground !== undefined && ir.gfxPatterns !== undefined) {
    const logicTypeByName = new Map<string, number>();
    for (const p of ir.gfxPatterns) {
      if (p.editName !== undefined) logicTypeByName.set(p.editName, p.logicType);
    }
    const blockedPattern = (dictIndex: number | undefined): boolean => {
      if (dictIndex === undefined) return false;
      const name = map.ground?.patterns[dictIndex];
      if (name === undefined) return false;
      const logicType = logicTypeByName.get(name);
      return logicType !== undefined && BLOCKING_GROUND_LOGIC_TYPES.has(logicType);
    };
    for (let i = 0; i < typeIds.length; i++) {
      if (blockedPattern(map.ground.a[i]) || blockedPattern(map.ground.b[i])) {
        typeIds[i] = TERRAIN_WATER;
      }
    }
  }

  // --- objects: each placement's walk-block body + build-block margin -------------------------------
  if (map.objects !== undefined && ir.landscapeGfx !== undefined) {
    const gfxByName = new Map<string, { walk: [number, number][]; margin: [number, number][] }>();
    for (const g of ir.landscapeGfx) {
      if (g.editName === undefined) continue;
      const walk = fullStateOffsets(g.walkBlockAreas);
      const build = fullStateOffsets(g.buildBlockAreas);
      if (walk.length === 0 && build.length === 0) continue; // pure decor (flowers, waves) never blocks
      const walkKeys = new Set(walk.map(([dx, dy]) => `${dx},${dy}`));
      gfxByName.set(g.editName, {
        walk,
        margin: build.filter(([dx, dy]) => !walkKeys.has(`${dx},${dy}`)),
      });
    }
    const stamp = (cx: number, cy: number, cls: number): void => {
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) return;
      const i = cy * width + cx;
      const current = typeIds[i];
      // Severity order: body > water > margin > open. A margin never downgrades a water/body cell.
      if (cls === TERRAIN_BLOCKED) typeIds[i] = TERRAIN_BLOCKED;
      else if (current === TERRAIN_OPEN) typeIds[i] = cls;
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
      // The `emla` half-cell (hx, hy) anchors the object on cell (hx>>1, hy>>1) — the same reduction
      // the render-side object loader applies; area offsets are cell-relative to that anchor.
      const ax = hx >> 1;
      const ay = hy >> 1;
      for (const [dx, dy] of gfx.walk) stamp(ax + dx, ay + dy, TERRAIN_BLOCKED);
      for (const [dx, dy] of gfx.margin) stamp(ax + dx, ay + dy, TERRAIN_MARGIN);
    }
  }

  return { width, height, typeIds };
}
