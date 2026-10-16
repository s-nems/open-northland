import { cellAnchorNode, components, ONE, positionOfNode, type Simulation } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../catalog/buildings.js';
import { WONDER_TRIBE, WONDERS } from '../catalog/wonders.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import type { SceneDefinition, SceneStage } from './types.js';

const { Building, Health, Owner, ownerOf, Position, Stockpile, UnderConstruction } = components;

/** Cells between two stages of one wonder and between two wonders' rows: the widest record (the pyramid)
 *  and the tallest (the Artemis temple) keep clear of their neighbours at these steps. */
const COLUMN_STEP = 16;
const ROW_STEP = 22;
const MARGIN_X = 9;
/** Room above the first row for its sprite and below the last for its footprint. */
const MARGIN_TOP = 13;
const MARGIN_BOTTOM = 10;
const MOST_LEVELS = Math.max(...WONDERS.map((w) => w.levels));
const MAP_W = MARGIN_X * 2 + COLUMN_STEP * (MOST_LEVELS - 1);
const MAP_H = MARGIN_TOP + ROW_STEP * (WONDERS.length - 1) + MARGIN_BOTTOM;
/** Rows a stage's camera sits above the anchors, since every wonder rises north of its anchor. */
const FOCUS_LIFT = 4;
const STAGE_ZOOM = 0.4;
const OVERVIEW_ZOOM = 0.35;

function rowY(row: number): number {
  return MARGIN_TOP + row * ROW_STEP;
}

function columnX(level: number): number {
  return MARGIN_X + level * COLUMN_STEP;
}

/**
 * A finished wonder at `level`, as a script's `SetHouse` and `SetHouseExtensionLevel` leave it: the
 * placement's components on the anchor, then the level written onto the house.
 */
function placeWonder(sim: Simulation, typeId: number, level: number, x: number, y: number): void {
  const node = cellAnchorNode(x, y);
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(node.hx, node.hy));
  sim.world.add(e, Building, { buildingType: typeId, tribe: WONDER_TRIBE, built: ONE, level });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  const hitpoints = sim.content.buildings.find((b) => b.typeId === typeId)?.hitpoints;
  if (hitpoints !== undefined) sim.world.add(e, Health, { hitpoints, max: hitpoints });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
}

function build(sim: Simulation): void {
  for (const [row, wonder] of WONDERS.entries()) {
    for (let level = 0; level < wonder.levels; level++) {
      placeWonder(sim, wonder.typeId, level, columnX(level), rowY(row));
    }
  }
}

/** Every wonder stands finished once per level, levels rising west to east, owned by the viewer. */
function everyWonderAtEachLevel(sim: Simulation): boolean {
  const houses = [...sim.world.query(Building)];
  if (houses.length !== WONDERS.reduce((sum, w) => sum + w.levels, 0)) return false;
  return WONDERS.every((wonder) => {
    const levels = houses
      .filter((e) => sim.world.get(e, Building).buildingType === wonder.typeId)
      .filter((e) => !sim.world.has(e, UnderConstruction) && ownerOf(sim.world, e) === HUMAN_PLAYER)
      .sort((a, b) => sim.world.get(a, Position).x - sim.world.get(b, Position).x)
      .map((e) => sim.world.get(e, Building).level);
    return levels.length === wonder.levels && levels.every((level, index) => level === index);
  });
}

const STAGES: readonly SceneStage[] = WONDERS.map((wonder, row) => ({
  id: wonder.id,
  focus: { x: (columnX(0) + columnX(wonder.levels - 1)) / 2, y: rowY(row) - FOCUS_LIFT },
  zoom: STAGE_ZOOM,
  actions: [],
}));

/**
 * Every wonder the content defines in its own row, one finished house per stage from level 0 in the west
 * to its top level in the east. The browser view is the check that each stage draws its own body.
 */
export const wonderLevelsScene: SceneDefinition = {
  id: 'wonder-levels',
  seed: 47,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  contentExtras: { buildings: WONDERS.map(({ typeId, id }) => ({ typeId, id, kind: 'wonder' })) },
  graphicTribes: [VIKING, WONDER_TRIBE],
  initialZoom: OVERVIEW_ZOOM,
  runTicks: 20,
  stages: STAGES,
  checks: [
    {
      label: 'every wonder stands finished at each of its levels, in order',
      predicate: everyWonderAtEachLevel,
    },
  ],
};
