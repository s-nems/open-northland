import { TILE_HALF_H, TILE_HALF_W, terrainWorldBounds } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { goalMarkPoints } from '../src/hud/minimap/goal-marks.js';
import {
  minimapLayout,
  visibleMinimapRect,
  worldToMinimap,
  zoomMinimapLayout,
} from '../src/hud/minimap/model.js';
import { createLostGoals, LOST_GOAL_PULSE_MS, lostGoalPulse } from '../src/view/unit-controls/lost-goals.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const MAP_CELLS = 16;
const NODE_WIDTH = 2 * MAP_CELLS;
const OWN_SEAT = 0;
const OTHER_SEAT = 1;
const node = (hx: number, hy: number): number => hy * NODE_WIDTH + hx;
const TREE = node(5, 7);
const STORE = node(20, 3);

const lostSettler = (id: number, goal: number | null, owner = OWN_SEAT): Ent => ({
  id,
  components: {
    Settler: { jobType: 1 },
    Owner: { player: owner },
    LostWay: { cutOff: false, since: 0, goal },
  },
});
const settledSettler = (id: number): Ent => ({
  id,
  components: { Settler: { jobType: 1 }, Owner: { player: OWN_SEAT } },
});

describe('createLostGoals - the refused goals of the selected lost settlers', () => {
  const world = snapshotOf([
    lostSettler(1, TREE),
    lostSettler(2, STORE),
    lostSettler(3, TREE),
    lostSettler(4, null),
    settledSettler(5),
    lostSettler(6, STORE, OTHER_SEAT),
  ]);

  it('marks each selected settler goal once, on its half-cell node', () => {
    const goals = createLostGoals(NODE_WIDTH);
    expect(goals(world, new Set([1, 2, 3, 4, 5]), OWN_SEAT)).toEqual([
      { node: TREE, hx: 5, hy: 7 },
      { node: STORE, hx: 20, hy: 3 },
    ]);
  });

  it('marks nothing for an unselected, settled or goal-less settler', () => {
    const goals = createLostGoals(NODE_WIDTH);
    expect(goals(world, new Set(), OWN_SEAT)).toEqual([]);
    expect(goals(world, new Set([4, 5]), OWN_SEAT)).toEqual([]);
  });

  it("keeps another seat's goal to a whole-map view", () => {
    const goals = createLostGoals(NODE_WIDTH);
    expect(goals(world, new Set([6]), OWN_SEAT)).toEqual([]);
    expect(goals(world, new Set([6]), null)).toEqual([{ node: STORE, hx: 20, hy: 3 }]);
  });

  it('hands back the same list while the goals hold, a new one once the settler finds its way', () => {
    const goals = createLostGoals(NODE_WIDTH);
    const selection = new Set([1]);
    const first = goals(world, selection, OWN_SEAT);
    expect(goals(snapshotOf([lostSettler(1, TREE)], 1), selection, OWN_SEAT)).toBe(first);
    expect(goals(snapshotOf([settledSettler(1)], 2), selection, OWN_SEAT)).toEqual([]);
  });
});

describe('lostGoalPulse', () => {
  it('wraps once per pulse period', () => {
    expect(lostGoalPulse(0)).toBe(0);
    expect(lostGoalPulse(LOST_GOAL_PULSE_MS / 2)).toBeCloseTo(0.5);
    expect(lostGoalPulse(LOST_GOAL_PULSE_MS * 3 + LOST_GOAL_PULSE_MS / 4)).toBeCloseTo(0.25);
  });
});

describe('goalMarkPoints - a refused goal on the minimap', () => {
  const bounds = terrainWorldBounds(MAP_CELLS, MAP_CELLS);
  const SCREEN_W = 1600;
  const SCREEN_H = 900;
  const UI_SCALE = 1;
  const layout = minimapLayout(bounds, SCREEN_H, UI_SCALE, 'm', SCREEN_W);

  it('stands on the projected node, by the formula the roads and the camera box use', () => {
    const [at] = goalMarkPoints(layout, bounds, [{ hx: 5, hy: 7 }]);
    const expected = worldToMinimap(layout, bounds, 5 * TILE_HALF_W, (7 * TILE_HALF_H) / 2);
    expect(at?.x).toBeCloseTo(expected.x);
    expect(at?.y).toBeCloseTo(expected.y);
  });

  it('leaves out a goal outside the shown part of a zoomed map', () => {
    const corner = { x: bounds.minX + bounds.width / 8, y: bounds.minY + bounds.height / 8 };
    const ZOOM = 4;
    const zoomed = zoomMinimapLayout(layout, bounds, ZOOM, corner);
    const shown = visibleMinimapRect(zoomed);
    const points = goalMarkPoints(zoomed, bounds, [
      { hx: 2, hy: 2 },
      { hx: NODE_WIDTH - 2, hy: NODE_WIDTH - 2 },
    ]);
    expect(points).toHaveLength(1);
    const [near] = points;
    expect(near?.x).toBeGreaterThanOrEqual(shown.x);
    expect(near?.y).toBeGreaterThanOrEqual(shown.y);
  });
});
