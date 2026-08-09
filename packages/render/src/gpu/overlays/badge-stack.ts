import { Container, Graphics, Sprite } from 'pixi.js';
import type { TextureCache } from '../texture-cache.js';
import {
  type BuildingSignSheet,
  chainedFrame,
  type DoorBadgeRow,
  type HouseholdKind,
  SIGN_BAND_BOTTOM,
  SIGN_HALF_WIDTH,
  SIGN_HEIGHT,
  SIGN_STEP,
  signKindOf,
} from './sign-gfx.js';

/**
 * The drawn half of the door-badge marker: one building's sign chain, as the decoded `ls_temp` signs or
 * as the placeholder marks a checkout without `content/` gets. Both grow upward from the chain's own
 * anchor (the planted base row sits at y 0).
 */

/** Placeholder mark geometry (world px): a mark fills the pick band `signRowAt` gives its row, less an
 *  inset that keeps the outline stroke inside the band and reads the stacked rows apart. */
const MARK_INSET = 3;
const MARK_WIDTH = 2 * SIGN_HALF_WIDTH - 2 * MARK_INSET;
const MARK_HEIGHT = SIGN_STEP - 2 * MARK_INSET;
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

/** Top of `row`'s placeholder mark in anchor space (+y down): inset into the band `signRowAt` resolves
 *  to that row, so a click on the mark answers with that row. */
function markTop(row: number): number {
  return -SIGN_BAND_BOTTOM - (row + 1) * SIGN_STEP + MARK_INSET;
}

/** The placeholder stack when no art is decoded: the same rows as the sign chain, a coloured bar per
 *  worker and a rounded one per resident family, so the two read apart. */
export function makePlaceholderStack(rows: readonly DoorBadgeRow[], hearts: boolean): Container {
  const c = new Container();
  let drawn = 0;
  for (const row of rows) {
    const g = new Graphics();
    const yTop = markTop(drawn);
    if (row.role === 'single' || row.role === 'couple' || row.role === 'family') {
      g.ellipse(0, yTop + MARK_HEIGHT / 2, MARK_WIDTH / 2, MARK_HEIGHT / 2)
        .fill({ color: HOUSEHOLD_COLOR[row.role] })
        .stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    } else {
      g.rect(-MARK_WIDTH / 2, yTop, MARK_WIDTH, MARK_HEIGHT)
        .fill({ color: ROLE_COLOR[row.role] })
        .stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    }
    c.addChild(g);
    drawn++;
  }
  if (hearts) {
    const top = markTop(drawn - 1) - HEART_LIFT;
    for (let i = 0; i < HEART_COUNT; i++) {
      c.addChild(makeHeart((i - 1) * HEART_DRIFT, top - i * HEART_GAP));
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
