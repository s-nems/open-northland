import {
  halfCellToScreen,
  LOST_GOAL_COLOUR,
  LOST_GOAL_OUTLINE,
  type WorldBounds,
} from '@open-northland/render';
import type { Graphics } from 'pixi.js';
import { type MinimapLayout, visibleMinimapRect, worldToMinimap } from './model.js';

/** A half-cell node a mark stands on. */
export interface GoalNode {
  readonly hx: number;
  readonly hy: number;
}

/** A refused goal's diamond, half its diagonal and its outline width, in design px at HUD scale 1: a
 *  few screen px, about a unit dot's size, so it reads over the dots without hiding them. */
const MARK_HALF_DIAGONAL = 3.5;
const MARK_OUTLINE_WIDTH = 1;

/** Each node's absolute screen point on the minimap, leaving out the ones outside the shown picture. */
export function goalMarkPoints(
  layout: MinimapLayout,
  bounds: WorldBounds,
  nodes: readonly GoalNode[],
): { x: number; y: number }[] {
  const shown = visibleMinimapRect(layout);
  const points: { x: number; y: number }[] = [];
  for (const node of nodes) {
    const world = halfCellToScreen(node.hx, node.hy);
    const at = worldToMinimap(layout, bounds, world.x, world.y);
    if (at.x < shown.x || at.y < shown.y || at.x > shown.x + shown.w || at.y > shown.y + shown.h) continue;
    points.push(at);
  }
  return points;
}

/**
 * The selected lost settlers' refused goals as vector diamonds over the minimap, in screen space beside
 * the camera rectangle: the dot raster restamps only a few times a second. Redraws only when a mark
 * moves, the layout changes or the HUD rescales.
 */
export function createGoalMarks(graphics: Graphics): {
  draw(layout: MinimapLayout, bounds: WorldBounds, nodes: readonly GoalNode[], uiScale: number): void;
  clear(): void;
} {
  let lastKey = '';
  const clear = (): void => {
    lastKey = '';
    graphics.clear();
  };
  return {
    draw: (layout, bounds, nodes, uiScale) => {
      if (nodes.length === 0) {
        if (lastKey !== '') clear();
        return;
      }
      const points = goalMarkPoints(layout, bounds, nodes);
      const key = points.length === 0 ? '' : `${uiScale}:${points.map((p) => `${p.x},${p.y}`).join(';')}`;
      if (key === lastKey) return;
      lastKey = key;
      graphics.clear();
      const r = MARK_HALF_DIAGONAL * uiScale;
      for (const { x, y } of points) {
        graphics
          .poly([x, y - r, x + r, y, x, y + r, x - r, y])
          .fill({ color: LOST_GOAL_COLOUR })
          .stroke({ width: MARK_OUTLINE_WIDTH * uiScale, color: LOST_GOAL_OUTLINE });
      }
    },
    clear,
  };
}
