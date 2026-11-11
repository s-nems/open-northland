import { Container, Graphics } from 'pixi.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { tracePlotOutlines } from './construction-plot.js';
import type { PlacementOverlayCell } from './overlay.js';
import { ANCHOR_RING, STRING_BLOCKED } from './plan-stake.js';

/**
 * The ground a held building would take, drawn under its ghost: the body's cells as one lit patch, the
 * ground its later levels grow onto in the wash's upgrade tint around it, and a gold ring on the node
 * its door opens to. Over refusing ground the body's patch turns red. A project choice; the original
 * shows the house alone.
 */

/** A held building's ground at the hovered anchor, in half-cell nodes. */
export interface GhostPlot {
  /** The body the standing building blocks. */
  readonly cells: readonly PlacementOverlayCell[];
  /** The largest body its level chain reaches; absent when no level outgrows `cells`. */
  readonly grown?: readonly PlacementOverlayCell[];
  /** The node settlers enter from; absent for a type without a door point. */
  readonly door?: PlacementOverlayCell;
}

/** The patch under the body: pale where the house fits, red where it does not. Tuned by eye. */
const PATCH_OPEN = 0xfff4d0;
const PATCH_OPEN_ALPHA = 0.3;
const PATCH_BLOCKED_ALPHA = 0.36;
const PATCH_RIM_WIDTH = 2;
const PATCH_RIM_ALPHA = 0.85;
/** The ground kept for the later levels: the wash's upgrade ochre, fainter than the body's patch. */
const GROWN_COLOR = 0xd9a03a;
const GROWN_ALPHA = 0.3;
const GROWN_RIM_WIDTH = 1.5;
const GROWN_RIM_ALPHA = 0.7;
/** The door ring on the ground, and the dot in it. */
const DOOR_RING_RADIUS = { x: 11, y: 5.5 } as const;
const DOOR_RING_WIDTH = 2;
const DOOR_DOT_RADIUS = { x: 4, y: 2 } as const;
/** The ring's shade: the same ellipse a pixel lower and a pixel wider, under it. */
const DOOR_SHADE = 0x000000;
const DOOR_SHADE_ALPHA = 0.4;
const DOOR_SHADE_DROP = 1;
const DOOR_SHADE_GROW = 1;

/** The patches and door mark of `plot` in world coordinates. */
export function mintGhostPlot(plot: GhostPlot, elevation: ElevationField, refused: boolean): Container {
  const ground = new Container();
  if (plot.grown !== undefined) {
    ground.addChild(patch(plot.grown, elevation, GROWN_COLOR, GROWN_ALPHA, GROWN_RIM_ALPHA, GROWN_RIM_WIDTH));
  }
  ground.addChild(
    patch(
      plot.cells,
      elevation,
      refused ? STRING_BLOCKED : PATCH_OPEN,
      refused ? PATCH_BLOCKED_ALPHA : PATCH_OPEN_ALPHA,
      PATCH_RIM_ALPHA,
      PATCH_RIM_WIDTH,
    ),
  );
  if (plot.door !== undefined) {
    const p = projectNode(elevation, plot.door.col, plot.door.row);
    const door = new Graphics()
      .ellipse(p.x, p.y + DOOR_SHADE_DROP, DOOR_RING_RADIUS.x, DOOR_RING_RADIUS.y)
      .stroke({ color: DOOR_SHADE, alpha: DOOR_SHADE_ALPHA, width: DOOR_RING_WIDTH + DOOR_SHADE_GROW })
      .ellipse(p.x, p.y, DOOR_RING_RADIUS.x, DOOR_RING_RADIUS.y)
      .stroke({ color: ANCHOR_RING, width: DOOR_RING_WIDTH })
      .ellipse(p.x, p.y, DOOR_DOT_RADIUS.x, DOOR_DOT_RADIUS.y)
      .fill(ANCHOR_RING);
    ground.addChild(door);
  }
  return ground;
}

/** One rounded patch over `cells`: a fill and a rim just inside its outline. */
function patch(
  cells: readonly PlacementOverlayCell[],
  elevation: ElevationField,
  color: number,
  fillAlpha: number,
  rimAlpha: number,
  rimWidth: number,
): Graphics {
  const g = new Graphics();
  tracePlotOutlines(g.context, [{ cells }], elevation);
  g.fill({ color, alpha: fillAlpha });
  tracePlotOutlines(g.context, [{ cells }], elevation);
  g.stroke({ color, alpha: rimAlpha, width: rimWidth, alignment: 1 });
  return g;
}
