import { NAV_LANDSCAPE_TYPES } from '../../catalog/terrain.js';
import { GATHERERS, type GathererSpec, GOOD_MUD } from './ids/index.js';

/** Structural, so both the authored cell grids and the sim's half-cell maps satisfy it. */
export interface TerrainTypeIds {
  readonly typeIds: ReadonlyArray<number>;
}

const RESOURCE_LANDSCAPE_BASE = 1000;
const RESOURCE_GFX_BASE = 2000;

function resourceLandscapeType(good: number): number {
  return RESOURCE_LANDSCAPE_BASE + good;
}

function resourceGfxIndex(good: number): number {
  return RESOURCE_GFX_BASE + good;
}

/** How many gfx fill states a bio, non-deposit resource cycles through. */
const BIO_LANDSCAPE_STATES = 3;

function landscapeState(g: GathererSpec): number {
  return Math.max(1, g.depositLevels ?? BIO_LANDSCAPE_STATES);
}

// The areas below are authored in the real block-area grammar: half-cell node offsets of
// `[state, dx, dy, run]`. Work cells sit one node from the anchor on every side, as the extracted
// records do, so a harvester works its node from whichever side it arrived.

function walkBlockAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.good === GOOD_MUD || g.mode === 'pick') return [];
  return [[state, 0, 0, 1]];
}

function buildBlockAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.good === GOOD_MUD || g.mode === 'pick') return [];
  return [[state, -2, 0, 5]]; // the one-cell no-build ring, as a single 5-node run
}

function workAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.mode === 'pick') return [[1, 0, 0, 1]];
  // Clay includes its own anchor, because the digger stands on the walkable deposit. A blocking node
  // instead offers the 8-neighbour ring around itself.
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
): Array<{ typeId: number; id: string; walkable: boolean; buildable: boolean; plantable?: boolean }> {
  const base = [
    ...NAV_LANDSCAPE_TYPES,
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

export function sandboxGatheringPipeline() {
  return GATHERERS.map((g) => ({
    goodType: g.good,
    goodId: g.id,
    harvestAtomic: g.atomic,
    bioLandscape: g.mode !== 'mine',
    harvest: { landscapeType: resourceLandscapeType(g.good), gfxIndices: [resourceGfxIndex(g.good)] },
  }));
}
