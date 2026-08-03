import { Container, Graphics, Sprite } from 'pixi.js';
import type { TextureCache } from '../texture-cache.js';
import {
  type BuildingSignSheet,
  chainedFrame,
  type DoorBadgeRow,
  type HouseholdKind,
  SIGN_HEIGHT,
  SIGN_STEP,
  signKindOf,
} from './sign-gfx.js';

/**
 * What one building's sign chain looks like - the drawn half of the door-badge marker, split from the
 * layer that decides which chains exist and where they stand. Two shapes of the same bottom-to-top row
 * list: the decoded `ls_temp` signs, and the placeholder squares a checkout without `content/` gets.
 * Both grow upward from the chain's own anchor (the planted base row sits at y 0).
 */

/** px the placeholder stack's base sits below its anchor node, so the squares stack up the wall from
 *  ground level. */
export const STACK_BASE_DROP = 6;

/** Placeholder square edge + vertical gap between stacked badges (world px). */
const SIZE = 9;
const GAP = 3;
/** Placeholder colours: one per worker role, with a dark outline so each reads on any ground. */
const ROLE_COLOR: Readonly<Record<'craftsman' | 'carrier' | 'gatherer', number>> = {
  craftsman: 0x5ab6ff, // blue - a workshop tradesman
  carrier: 0xffbb33, // amber - a hauler (tragarz)
  gatherer: 0x7ed957, // green - a raw-good gatherer
};
const BORDER_COLOR = 0x1a1206;
/** Placeholder household dot colours - one per family shape ({@link HouseholdKind}). */
const HOUSEHOLD_COLOR: Readonly<Record<HouseholdKind, number>> = {
  single: 0xd9d9d9, // grey - one settler lives here
  couple: 0xff7a9c, // pink - a married couple
  family: 0xffd24d, // gold - a couple raising a child
};
/** Hearts (make-love) drawing: colour, per-heart radius and the column they float in above the stack. */
const HEART_COLOR = 0xff4d78;
const HEART_RADIUS = 3.5;
const HEART_GAP = 12;
const HEART_LIFT = 26; // px above the stack's top - "hearts over the house"
const HEART_DRIFT = 4; // px of horizontal drift per heart, so the column reads as rising, not stacked
const HEART_COUNT = 3;

/** A door badge stack drawn from the decoded sign art: one player-coloured sign sprite per row,
 *  chained upward from the anchor ({@link SIGN_STEP}) - rows above the base draw their base-cropped
 *  variant ({@link chainedFrame}) so no rock clump lands on the emblem below - with the make-love
 *  hearts floating above. */
export function makeSignStack(
  rows: readonly DoorBadgeRow[],
  hearts: boolean,
  textures: TextureCache,
  sheet: BuildingSignSheet,
): Container {
  const c = new Container();
  let drawn = 0;
  for (const row of rows) {
    const kind = signKindOf(row.role);
    const base = sheet.frameByKind[kind];
    const frame = drawn === 0 ? base : chainedFrame(kind, base);
    const s = new Sprite(textures.get(sheet.source, frame));
    s.position.set(frame.offsetX, -(drawn * SIGN_STEP) + frame.offsetY);
    c.addChild(s);
    drawn++;
  }
  if (hearts) {
    const top = -((drawn - 1) * SIGN_STEP) - SIGN_HEIGHT - HEART_LIFT;
    for (let i = 0; i < HEART_COUNT; i++) {
      c.addChild(makeHeart((i - 1) * HEART_DRIFT, top - i * HEART_GAP));
    }
  }
  return c;
}

/** The placeholder stack (no decoded art): the same bottom-to-top rows as the sign chain, drawn as a
 *  coloured square per worker ({@link ROLE_COLOR}) and a round dot per resident family (round, so they
 *  read apart from the squares), growing up from the anchor, with the make-love hearts in a short
 *  column above it all. */
export function makeSquareStack(rows: readonly DoorBadgeRow[], hearts: boolean): Container {
  const c = new Container();
  let drawn = 0;
  for (const row of rows) {
    const g = new Graphics();
    if (row.role === 'single' || row.role === 'couple' || row.role === 'family') {
      const yCentre = -(drawn + 1) * (SIZE + GAP) + SIZE / 2;
      g.circle(SIZE / 2, yCentre, SIZE / 2)
        .fill({ color: HOUSEHOLD_COLOR[row.role] })
        .stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    } else {
      const yTop = -(drawn + 1) * (SIZE + GAP);
      g.rect(0, yTop, SIZE, SIZE)
        .fill({ color: ROLE_COLOR[row.role] })
        .stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    }
    c.addChild(g);
    drawn++;
  }
  if (hearts) {
    const top = -(drawn * (SIZE + GAP)) - HEART_LIFT;
    for (let i = 0; i < HEART_COUNT; i++) {
      c.addChild(makeHeart(SIZE / 2 + (i - 1) * HEART_DRIFT, top - i * HEART_GAP));
    }
  }
  return c;
}

/** One small heart at (`x`, `y`): two lobes + a point, in {@link HEART_COLOR}. */
function makeHeart(x: number, y: number): Graphics {
  const g = new Graphics();
  const r = HEART_RADIUS;
  g.circle(x - r * 0.6, y - r * 0.4, r * 0.7)
    .circle(x + r * 0.6, y - r * 0.4, r * 0.7)
    .poly([x - r * 1.25, y - r * 0.1, x + r * 1.25, y - r * 0.1, x, y + r * 1.4])
    .fill({ color: HEART_COLOR });
  return g;
}
