import { type Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { worldBatched } from './world-batcher.js';

/**
 * A stake in a ring of stones: the marker for one planned node of a line (a wall now, a road later), in
 * the placement preview and on a laid site until its piece stands. Its stones say whether the node takes
 * the line: grey where it can go, red where it cannot. A claimed site pulls the stake and plants the
 * builder's flag in the ring instead. All three pieces of art share one frame and ground point.
 */
export interface PlanStakeTextures {
  readonly open: Texture;
  readonly blocked: Texture;
  readonly ring: Texture;
}

export type PlanStakeLook = keyof PlanStakeTextures;

/** The art's size: pixel art at the game's own scale, one art pixel per world px. */
const ART_WIDTH_PX = 24;
const ART_HEIGHT_PX = 23;
/** World px across the ring and up the stake. */
const STAKE_WIDTH = ART_WIDTH_PX;
const STAKE_HEIGHT = ART_HEIGHT_PX;
/** Where the stake meets the ground and where its rope is tied, as fractions of the art; whole art
 *  pixels, so the texels land on the world's pixel grid as the game's sprites do. */
const ART_GROUND = { x: 12 / ART_WIDTH_PX, y: 16 / ART_HEIGHT_PX } as const;
const ART_KNOT_Y = 7 / ART_HEIGHT_PX;

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

/** One marker with its ground point at the display object's origin. */
export function mintPlanStake(art: PlanStakeTextures | undefined, look: PlanStakeLook): Container {
  if (art !== undefined) {
    const sprite = worldBatched(new Sprite(art[look]));
    sprite.anchor.set(ART_GROUND.x, ART_GROUND.y);
    sprite.scale.set(STAKE_HEIGHT / sprite.texture.height);
    return sprite;
  }
  const g = new Graphics();
  if (look === 'ring') {
    return g.ellipse(0, 0, STAKE_WIDTH / 2, STAKE_WIDTH / 4).stroke({ color: FALLBACK_OPEN, width: 2 });
  }
  const open = look === 'open';
  const top = -STAKE_TIE_HEIGHT - FALLBACK_HALF_W * 2;
  g.rect(-FALLBACK_HALF_W, top, FALLBACK_HALF_W * 2, -top).fill(FALLBACK_WOOD);
  g.rect(-FALLBACK_HALF_W, -STAKE_TIE_HEIGHT - 1, FALLBACK_HALF_W * 2, 2).fill(
    open ? FALLBACK_OPEN : FALLBACK_BLOCKED,
  );
  return g;
}
