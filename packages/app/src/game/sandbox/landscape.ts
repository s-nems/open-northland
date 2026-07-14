import {
  TERRAIN_BARREN,
  TERRAIN_BLOCKED,
  TERRAIN_IMPASSABLE,
  TERRAIN_MARGIN,
  TERRAIN_OPEN,
} from '../../catalog/terrain.js';
import { GATHERERS, type GathererSpec, GOOD_MUD } from './ids/index.js';

/**
 * The sandbox terrain + gathering-resource landscape derivation — the semantic terrain classes, the
 * per-gatherer harvest-node landscape/gfx rows, and their block/work areas. The global
 * {@link import('./content/index.js').sandboxContent} set assembles `landscape`/`landscapeGfx`/
 * `gatheringPipeline` from the builders here; `sandboxWalkableTypeIds` is the placement gate's read
 * of the same derivation.
 */

/** The one thing the sandbox landscape derivation reads off a terrain grid — its typeId lane.
 *  Structural, so both the authored cell grids and the sim's half-cell maps satisfy it. */
export interface TerrainTypeIds {
  readonly typeIds: ReadonlyArray<number>;
}

// The semantic terrain-class rows (see catalog/terrain.ts — the shared vocabulary scene grids are
// authored in and `content/collision.ts` resolves real maps into). Row ids keep the authored-scene
// reading: sandbox typeId 1 is water; a resolved real map lands other impassable ground there too.
const BASE_LANDSCAPE = [
  // Grass is the one plantable class — the original's `biocanplanton` ground flag (trianglepattern-
  // types.cif) belongs to `land` alone, so grain fields land here and nowhere else.
  { typeId: TERRAIN_OPEN, id: 'grass', walkable: true, buildable: true, plantable: true },
  { typeId: TERRAIN_IMPASSABLE, id: 'water', walkable: false, buildable: false },
  { typeId: TERRAIN_BLOCKED, id: 'landscape_body', walkable: false, buildable: false },
  { typeId: TERRAIN_MARGIN, id: 'landscape_margin', walkable: true, buildable: false },
  // Sand/beach/desert stone: open for walking and building, closed to the plough (no `biocanplanton`).
  { typeId: TERRAIN_BARREN, id: 'barren', walkable: true, buildable: true },
] as const;

const RESOURCE_LANDSCAPE_BASE = 1000;
const RESOURCE_GFX_BASE = 2000;

function resourceLandscapeType(good: number): number {
  return RESOURCE_LANDSCAPE_BASE + good;
}

function resourceGfxIndex(good: number): number {
  return RESOURCE_GFX_BASE + good;
}

/** Fill-state count for a bio (non-deposit) resource — trees/mushrooms cycle through this many gfx states. */
const BIO_LANDSCAPE_STATES = 3;

function landscapeState(g: GathererSpec): number {
  return Math.max(1, g.depositLevels ?? BIO_LANDSCAPE_STATES);
}

// The invented resource areas below are half-cell node offsets (`[state, dx, dy, run]`, the real
// block-area grammar). The build ring keeps its doubled (one-cell) extent; the work cells sit one
// node from the anchor on every side, matching the real records (the yew's `workAreas` are the
// ±1-node neighbours) — so a harvester stands half a cell from its node and works it from whichever
// side it arrived, instead of circling to a distant east/west post.

function walkBlockAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.good === GOOD_MUD || g.mode === 'pick') return [];
  return [[state, 0, 0, 1]];
}

function buildBlockAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.good === GOOD_MUD || g.mode === 'pick') return [];
  return [[state, -2, 0, 5]]; // dx −2..+2 — the one-cell no-build ring, as a single 5-node run
}

function workAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.mode === 'pick') return [[1, 0, 0, 1]];
  // Clay includes its own anchor (the digger stands on the walkable deposit — resourceWorkCell's
  // anchor-first rule); the blocking nodes offer the 8-neighbour ring around theirs.
  if (g.good === GOOD_MUD) {
    return [
      [state, -1, -1, 3],
      [state, -1, 0, 3],
      [state, -1, 1, 3],
    ];
  }
  return [
    [state, -1, -1, 3],
    [state, -1, 0, 1],
    [state, 1, 0, 1],
    [state, -1, 1, 3],
  ];
}

export function sandboxLandscape(
  map?: TerrainTypeIds,
): Array<{ typeId: number; id: string; walkable: boolean; buildable: boolean }> {
  const base = [
    ...BASE_LANDSCAPE,
    ...GATHERERS.map((g) => ({
      typeId: resourceLandscapeType(g.good),
      id: `${g.id}_harvest_node`,
      walkable: true,
      buildable: true,
    })),
  ];
  if (map === undefined) return base;
  const covered = new Set(base.map((t) => t.typeId));
  const extra = [...new Set(map.typeIds)].filter((id) => !covered.has(id)).sort((a, b) => a - b);
  return [
    ...base,
    ...extra.map((id) => ({ typeId: id, id: `terrain_${id}`, walkable: true, buildable: true })),
  ];
}

export function sandboxWalkableTypeIds(map?: TerrainTypeIds): ReadonlySet<number> {
  return new Set(
    sandboxLandscape(map)
      .filter((t) => t.walkable)
      .map((t) => t.typeId),
  );
}

/**
 * The gathering-resource landscape gfx rows — one per {@link GATHERERS} entry (its block/work areas,
 * gfx index, and fill-state valency). See the invented-area note above.
 */
export function sandboxLandscapeGfx() {
  return GATHERERS.map((g) => ({
    index: resourceGfxIndex(g.good),
    editName: `sandbox ${g.id} resource`,
    logicType: resourceLandscapeType(g.good),
    maxValency: landscapeState(g),
    isWorkable: true,
    walkBlockAreas: walkBlockAreas(g),
    buildBlockAreas: buildBlockAreas(g),
    workAreas: workAreas(g),
  }));
}

/** The gathering pipeline rows — one per {@link GATHERERS} entry (good → its harvest landscape/gfx). */
export function sandboxGatheringPipeline() {
  return GATHERERS.map((g) => ({
    goodType: g.good,
    goodId: g.id,
    harvestAtomic: g.atomic,
    bioLandscape: g.mode !== 'mine',
    harvest: { landscapeType: resourceLandscapeType(g.good), gfxIndices: [resourceGfxIndex(g.good)] },
  }));
}
