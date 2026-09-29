import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { STRING_BLOCKED } from './plan-stake.js';

/**
 * A round, pegged plot of cobbles: the marker for one planned road node, in the road tool's preview and on a laid
 * site until its road is paved. A node that takes no road draws the plot tinted red under a red cross,
 * since the art's red pegs alone do not read at plot size. A claimed site pulls the pegs and plants the
 * builder's flag in the plot instead. All three pieces of art share one frame and ground point.
 */
export interface PlanRoadTextures {
  readonly open: Texture;
  readonly blocked: Texture;
  readonly claimed: Texture;
}

export type PlanRoadLook = keyof PlanRoadTextures;

/** World px across the plot; the art is generated for this project, sized by eye against a settler. */
const PLOT_WIDTH = 15;
/** Where the plot's centre meets the ground, as fractions of the art: the middle of the rim's ellipse. */
const ART_GROUND = { x: 0.499, y: 0.435 } as const;
const ART_WIDTH_PX = 112;
const ART_HEIGHT_PX = 74;
const ART_ASPECT = ART_WIDTH_PX / ART_HEIGHT_PX;
const PLOT_HEIGHT = PLOT_WIDTH / ART_ASPECT;

/** The drawn box around the ground point, for hit bounds: left, top, right and bottom offsets. */
export const PLOT_BOUNDS = {
  left: -ART_GROUND.x * PLOT_WIDTH,
  top: -ART_GROUND.y * PLOT_HEIGHT,
  right: (1 - ART_GROUND.x) * PLOT_WIDTH,
  bottom: (1 - ART_GROUND.y) * PLOT_HEIGHT,
} as const;

/** Without the art (a bare render test, the `?shot` entry) a flat outlined patch of the same size stands in. */
const FALLBACK_STONE = 0x9a9a92;
const FALLBACK_CLAIMED = 0xe9dcc0;
const FALLBACK_BLOCKED = 0xd23a2e;
const FALLBACK_FILL_ALPHA = 0.45;
const FALLBACK_STROKE_WIDTH = 1.5;

const FALLBACK_COLOUR: Readonly<Record<PlanRoadLook, number>> = {
  open: FALLBACK_STONE,
  blocked: FALLBACK_BLOCKED,
  claimed: FALLBACK_CLAIMED,
};

/** Multiplied over a refused plot's art, so its stones read red. Tuned by eye. */
const BLOCKED_TINT = 0xff6a5a;
/** Half the width of the cross over a refused plot or a site a cancel line withdraws, in world px. */
const CROSS_HALF_W = PLOT_WIDTH * 0.3;
const CROSS_HALF_H = CROSS_HALF_W * 0.6;
const CROSS_WIDTH = 2;
const CROSS_SHADOW_WIDTH = 3.5;
const CROSS_SHADOW = 0x000000;
const CROSS_SHADOW_ALPHA = 0.45;

/** A red cross over the plot centred at `(x, y)`, with a dark underlay that keeps it readable on pale
 *  ground. */
export function drawPlotCross(g: Graphics, x: number, y: number): Graphics {
  const strokes = (width: number, color: number, alpha: number): void => {
    g.moveTo(x - CROSS_HALF_W, y - CROSS_HALF_H)
      .lineTo(x + CROSS_HALF_W, y + CROSS_HALF_H)
      .moveTo(x + CROSS_HALF_W, y - CROSS_HALF_H)
      .lineTo(x - CROSS_HALF_W, y + CROSS_HALF_H)
      .stroke({ color, width, alpha, cap: 'round' });
  };
  strokes(CROSS_SHADOW_WIDTH, CROSS_SHADOW, CROSS_SHADOW_ALPHA);
  strokes(CROSS_WIDTH, STRING_BLOCKED, 1);
  return g;
}

/** The plot's rim at `(x, y)` grown by `grow` world px, for an outline around it. */
export function plotRim(g: Graphics, x: number, y: number, grow: number): Graphics {
  return g.ellipse(x, y, PLOT_WIDTH / 2 + grow, PLOT_HEIGHT / 2 + grow);
}

/** One plot with its ground point at the display object's origin. */
export function mintPlanRoad(art: PlanRoadTextures | undefined, look: PlanRoadLook): Container {
  const plot = mintPlot(art, look);
  if (look !== 'blocked') return plot;
  const marked = new Container();
  marked.addChild(plot, drawPlotCross(new Graphics(), 0, 0));
  return marked;
}

function mintPlot(art: PlanRoadTextures | undefined, look: PlanRoadLook): Container {
  if (art !== undefined) {
    const sprite = new Sprite(art[look]);
    sprite.anchor.set(ART_GROUND.x, ART_GROUND.y);
    sprite.scale.set(PLOT_HEIGHT / sprite.texture.height);
    if (look === 'blocked') sprite.tint = BLOCKED_TINT;
    return sprite;
  }
  const colour = FALLBACK_COLOUR[look];
  return new Graphics()
    .ellipse(0, 0, PLOT_WIDTH / 2, PLOT_HEIGHT / 2)
    .fill({ color: colour, alpha: FALLBACK_FILL_ALPHA })
    .stroke({ color: colour, width: FALLBACK_STROKE_WIDTH });
}
