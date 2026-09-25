import { type Container, Graphics, Sprite, type Texture } from 'pixi.js';

/**
 * A stake in a ring of stones: the marker for one planned node of a line (a wall now, a road later), in
 * the placement preview and on a laid site until its piece stands. Its stones say whether the node takes
 * the line: sandstone where it can go, red where it cannot.
 */
export interface PlanStakeTextures {
  readonly open: Texture;
  readonly blocked: Texture;
}

/** World px across the ring; the art is generated for this project, sized by eye against a settler. */
const STAKE_WIDTH = 24;
/** Where the stake meets the ground and where its rope is tied, as fractions of the art. */
const ART_GROUND = { x: 0.49, y: 0.67 } as const;
const ART_KNOT_Y = 0.265;
const ART_ASPECT = 855 / 680;
const STAKE_HEIGHT = STAKE_WIDTH / ART_ASPECT;

/** How far up the stake the string ties on, in world px from the ground point. */
export const STAKE_TIE_HEIGHT = Math.round((ART_GROUND.y - ART_KNOT_Y) * STAKE_HEIGHT);

/** The drawn box around the ground point, for hit bounds: left, top, right and bottom offsets. */
export const STAKE_BOUNDS = {
  left: -ART_GROUND.x * STAKE_WIDTH,
  top: -ART_GROUND.y * STAKE_HEIGHT,
  right: (1 - ART_GROUND.x) * STAKE_WIDTH,
  bottom: (1 - ART_GROUND.y) * STAKE_HEIGHT,
} as const;

/** The string between stakes: hemp where the line runs, red into a refused node. */
export const STRING_OPEN = 0xd8c089;
export const STRING_BLOCKED = 0xd23a2e;

/** Without the art (a bare render test, the `?shot` entry) a flat post of the same size stands in. */
const FALLBACK_WOOD = 0x8a5a2b;
const FALLBACK_OPEN = 0xe9dcc0;
const FALLBACK_BLOCKED = STRING_BLOCKED;
const FALLBACK_HALF_W = 2.5;

/** One stake with its ground point at the display object's origin. */
export function mintPlanStake(art: PlanStakeTextures | undefined, open: boolean): Container {
  if (art !== undefined) {
    const sprite = new Sprite(open ? art.open : art.blocked);
    sprite.anchor.set(ART_GROUND.x, ART_GROUND.y);
    sprite.scale.set(STAKE_HEIGHT / sprite.texture.height);
    return sprite;
  }
  const g = new Graphics();
  const top = -STAKE_TIE_HEIGHT - FALLBACK_HALF_W * 2;
  g.rect(-FALLBACK_HALF_W, top, FALLBACK_HALF_W * 2, -top).fill(FALLBACK_WOOD);
  g.rect(-FALLBACK_HALF_W, -STAKE_TIE_HEIGHT - 1, FALLBACK_HALF_W * 2, 2).fill(
    open ? FALLBACK_OPEN : FALLBACK_BLOCKED,
  );
  return g;
}
