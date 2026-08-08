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
 * The drawn half of the door-badge marker: one building's sign chain, as the decoded `ls_temp` signs or
 * as the placeholder squares a checkout without `content/` gets. Both grow upward from the chain's own
 * anchor (the planted base row sits at y 0).
 */

/** px the placeholder stack's base sits below its anchor node. */
export const STACK_BASE_DROP = 6;

/** Placeholder square edge + vertical gap between stacked badges (world px). */
const SIZE = 9;
const GAP = 3;
/** Placeholder colours: one per worker role, with a dark outline so each reads on any ground. */
const ROLE_COLOR: Readonly<Record<'craftsman' | 'carrier' | 'gatherer', number>> = {
  craftsman: 0x5ab6ff, // blue
  carrier: 0xffbb33, // amber
  gatherer: 0x7ed957, // green
};
const BORDER_COLOR = 0x1a1206;
/** Placeholder household dot colours, one per family shape. */
const HOUSEHOLD_COLOR: Readonly<Record<HouseholdKind, number>> = {
  single: 0xd9d9d9, // grey
  couple: 0xff7a9c, // pink
  family: 0xffd24d, // gold
};
/** The make-love hearts floating above a stack. */
const HEART_COLOR = 0xff4d78;
const HEART_RADIUS = 3.5;
const HEART_GAP = 12;
const HEART_LIFT = 26; // px above the stack's top
const HEART_DRIFT = 4; // px of horizontal drift per heart, so the column reads as rising
const HEART_COUNT = 3;

/** A door badge stack from the decoded sign art: one player-coloured sign sprite per row, chained
 *  upward from the anchor, with the make-love hearts floating above. */
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

/** The placeholder stack when no art is decoded: the same rows as the sign chain, a coloured square per
 *  worker and a round dot per resident family, so the two read apart. */
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

function makeHeart(x: number, y: number): Graphics {
  const g = new Graphics();
  const r = HEART_RADIUS;
  g.circle(x - r * 0.6, y - r * 0.4, r * 0.7)
    .circle(x + r * 0.6, y - r * 0.4, r * 0.7)
    .poly([x - r * 1.25, y - r * 0.1, x + r * 1.25, y - r * 0.1, x, y + r * 1.4])
    .fill({ color: HEART_COLOR });
  return g;
}
