import type { Graphics } from 'pixi.js';

/**
 * A surveyor's stake: the marker for one planned node of a line (a wall now, a road later), in the
 * placement preview and on a laid site no builder has claimed yet. Its tape says whether the node takes
 * the line. Shape and colours are an approximation tuned by eye.
 */

/** World px from the ground point: the stake's half width, its shaft to the shoulder and the tip above. */
const STAKE_HALF_W = 2.5;
const STAKE_SHOULDER = 10;
const STAKE_TIP = 14;
/** Where the tape and the string tie on, measured up the shaft. */
export const STAKE_TIE_HEIGHT = 8;
const TAPE_H = 3;

const WOOD = 0x9a6a38;
const WOOD_LIT = 0xc89456;
const OUTLINE = 0x2a1a0c;
const SHADOW_ALPHA = 0.35;
/** Marking tape: a warm cream where the line can go, a signal red where it cannot. */
export const TAPE_OPEN = 0xf3e2a4;
export const TAPE_BLOCKED = 0xe0483c;
const ANCHOR_RING = 0xf2c14e;

/** The ground-to-tip box, for hit bounds: left, top, right and bottom offsets from the ground point. */
export const STAKE_BOUNDS = { left: -7, top: -STAKE_TIP - 1, right: 9, bottom: 3 } as const;

export interface StakeStyle {
  readonly open: boolean;
  /** The line's first click: a ring on the ground marks where it starts. */
  readonly anchor?: boolean;
}

export function drawPlanStake(g: Graphics, x: number, y: number, style: StakeStyle): void {
  if (style.anchor === true) {
    g.ellipse(x, y, 11, 5.5).stroke({ color: ANCHOR_RING, width: 2, alpha: 0.95 });
  }
  g.ellipse(x + 2, y, 6, 2.5).fill({ color: 0x000000, alpha: SHADOW_ALPHA });
  const shaft = [
    x - STAKE_HALF_W,
    y,
    x + STAKE_HALF_W,
    y,
    x + STAKE_HALF_W,
    y - STAKE_SHOULDER,
    x,
    y - STAKE_TIP,
    x - STAKE_HALF_W,
    y - STAKE_SHOULDER,
  ];
  g.poly(shaft).fill(WOOD);
  // The lit left face gives the shaft some roundness.
  g.poly([x - STAKE_HALF_W, y, x, y, x, y - STAKE_TIP, x - STAKE_HALF_W, y - STAKE_SHOULDER]).fill(WOOD_LIT);
  g.poly(shaft).stroke({ color: OUTLINE, width: 1, alpha: 0.9 });
  g.rect(x - STAKE_HALF_W - 0.5, y - STAKE_TIE_HEIGHT - TAPE_H / 2, STAKE_HALF_W * 2 + 1, TAPE_H)
    .fill(style.open ? TAPE_OPEN : TAPE_BLOCKED)
    .stroke({ color: OUTLINE, width: 0.75, alpha: 0.6 });
  // The loose tape end flutters to the right of the knot.
  g.poly([
    x + STAKE_HALF_W,
    y - STAKE_TIE_HEIGHT - 1,
    x + STAKE_HALF_W + 5,
    y - STAKE_TIE_HEIGHT + 1,
    x + STAKE_HALF_W + 4,
    y - STAKE_TIE_HEIGHT + 3,
    x + STAKE_HALF_W,
    y - STAKE_TIE_HEIGHT + 1,
  ]).fill(style.open ? TAPE_OPEN : TAPE_BLOCKED);
}
