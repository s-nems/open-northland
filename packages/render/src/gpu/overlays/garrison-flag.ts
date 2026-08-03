import { Container, Graphics, Sprite } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { TextureCache } from '../texture-cache.js';
import type { BuildingSignSheet } from './sign-gfx.js';

/**
 * The garrison flag - the marker a manned post flies from its roof instead of one worker sign per
 * soldier. The art is the original's player-coloured `ls_temp` `soldier 01`..`05` records, each an
 * eight-frame wave loop; the tower records' own `gfxsoldierflagpoint` says where it is planted, which is
 * what ties these five to a manned tower rather than to any other sign.
 *
 * The badge layer owns where it flies and when it is rebuilt; this module owns what it looks like.
 */

/**
 * The most stars a flag flies. EXTRACTED: exactly five records per player slot, drawing 1..5 stars in
 * that order (`soldier 01` = bob 36 … `soldier 05` = bob 68). APPROXIMATION, from observation: one star
 * means one man, and a bigger post (the big tower employs eight bows) saturates here rather than gauging
 * its capacity across the same five steps.
 */
export const GARRISON_STAR_MAX = 5;

/**
 * Sim ticks per wave frame. `GfxLoopAnimation` says the frames loop, never how fast, so this is an
 * APPROXIMATION: the mill rotor's cadence, which puts a full 8-frame wave at 16 ticks (~1.3 s at x1,
 * `TICKS_PER_SECOND` 12).
 */
export const GARRISON_TICKS_PER_FRAME = 2;

/**
 * The flag's clickable band, world px from its mast anchor (+y down): the drawn `soldier` frame's own
 * extent (46x43 at offset -4,-38; the wave frames vary by up to 2 px, so the box is the authored one).
 * Owned here with the drawing, so a click lands on the cloth the player aimed at rather than falling
 * through to the ground ~230 px below the banner.
 */
export function hitsGarrisonFlag(dx: number, dy: number): boolean {
  return dx >= -4 && dx <= 42 && dy >= -38 && dy <= 5;
}

/** A wave loop whose type carries its first frame, so callers never re-prove it is non-empty. */
export type WaveLoop = readonly [AtlasFrame, ...AtlasFrame[]];

/** A built flag: the node to mount at the mast point, plus the per-frame wave step when it draws real
 *  art (the placeholder mast does not animate). */
export interface GarrisonFlagMark {
  readonly node: Container;
  readonly advance?: (clock: number) => void;
}

/** The wave loop a `stars`-strong post flies; undefined with no flag art or no post at all. Stars beyond
 *  {@link GARRISON_STAR_MAX} fly the top record. */
export function garrisonFlagLoop(sheet: BuildingSignSheet | undefined, stars: number): WaveLoop | undefined {
  if (stars < 1) return undefined;
  const [first, ...rest] = sheet?.garrison?.[Math.min(stars, GARRISON_STAR_MAX) - 1] ?? [];
  return first === undefined ? undefined : [first, ...rest];
}

/** The flag a `stars`-strong post flies: its wave loop from `sheet` when the art resolved, else the
 *  placeholder mast. */
export function makeGarrisonFlag(
  stars: number,
  textures: TextureCache | undefined,
  sheet: BuildingSignSheet | undefined,
): GarrisonFlagMark {
  const loop = garrisonFlagLoop(sheet, stars);
  if (loop === undefined || sheet === undefined || textures === undefined) {
    return { node: makePlaceholderFlag(stars) };
  }
  const { source } = sheet;
  const sprite = new Sprite();
  // The sprite carries the frame's own draw offset, so the node the layer positions stays the mast foot.
  const node = new Container();
  node.addChild(sprite);
  const advance = (clock: number): void => {
    const frame = loop[Math.floor(clock / GARRISON_TICKS_PER_FRAME) % loop.length] ?? loop[0];
    sprite.texture = textures.get(source, frame);
    sprite.position.set(frame.offsetX, frame.offsetY);
  };
  advance(0);
  return { node, advance };
}

/** Placeholder mast + pennant + a dot per star (world px, drawn up from the mast foot). */
const MAST_HEIGHT = 34;
const MAST_WIDTH = 2;
const MAST_COLOR = 0x6b4a26;
const PENNANT_WIDTH = 27;
const PENNANT_HEIGHT = 20;
const PENNANT_COLOR = 0x3b6fd4;
const STAR_RADIUS = 2.5;
const STAR_COLOR = 0xffcc33;
/** Placeholder stars per row, so five fit the pennant. */
const STAR_COLUMNS = 3;

/** The no-art flag, drawn in roughly the band the real art occupies. */
function makePlaceholderFlag(stars: number): Graphics {
  const g = new Graphics();
  const top = -MAST_HEIGHT;
  g.rect(-MAST_WIDTH / 2, top, MAST_WIDTH, MAST_HEIGHT).fill({ color: MAST_COLOR });
  g.rect(MAST_WIDTH / 2, top, PENNANT_WIDTH, PENNANT_HEIGHT).fill({ color: PENNANT_COLOR });
  const shown = Math.min(stars, GARRISON_STAR_MAX);
  for (let i = 0; i < shown; i++) {
    const col = i % STAR_COLUMNS;
    const row = i < STAR_COLUMNS ? 0 : 1;
    g.circle(
      MAST_WIDTH / 2 + (col + 0.5) * (PENNANT_WIDTH / STAR_COLUMNS),
      top + (row + 0.5) * (PENNANT_HEIGHT / 2),
      STAR_RADIUS,
    ).fill({ color: STAR_COLOR });
  }
  return g;
}
