import { Container, Graphics, Sprite } from 'pixi.js';
import { type AtlasFrame, type WaveLoop, waveFrameAt } from '../../../data/sprites/index.js';
import type { TextureCache } from '../../textures/texture-cache.js';
import { worldBatched } from '../../world-batch/batcher.js';
import {
  type BuildingSignSheet,
  chainedFrame,
  type DoorBadgeRow,
  type HouseholdKind,
  SIGN_BAND_BOTTOM,
  SIGN_BASE_BELOW,
  SIGN_HALF_WIDTH,
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
/** Approximation: a pixel judgement, narrower than the clump the post stands in for. */
const POST_WIDTH = 8;
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
/** A built sign chain: its node, plus the per-frame wave step when a row draws a looping banner. */
export interface SignStackMark {
  readonly node: Container;
  readonly advance?: (clock: number) => void;
}

/** A door badge stack from the decoded sign art: one player-coloured sign sprite per row, chained
 *  upward from the anchor. The signs draw in the world batch of the sprites around them, unmagnified:
 *  the world shader reads them with one plain sampler tap, no magnifier. */
export function makeSignStack(
  rows: readonly DoorBadgeRow[],
  textures: TextureCache,
  sheet: BuildingSignSheet,
): SignStackMark {
  const node = new Container();
  const waving: {
    readonly sprite: Sprite;
    readonly loop: WaveLoop<AtlasFrame>;
    readonly rowY: number;
    shown: AtlasFrame;
  }[] = [];
  let drawn = 0;
  for (const row of rows) {
    const kind = signKindOf(row.role);
    const [base, ...baseRest] = sheet.loopByKind[kind];
    const chained = (frame: AtlasFrame): AtlasFrame => (drawn === 0 ? frame : chainedFrame(kind, frame));
    const first = chained(base);
    const rest = baseRest.map(chained);
    const loop: WaveLoop<AtlasFrame> = [first, ...rest];
    const s = worldBatched(new Sprite(textures.unmagnified(textures.get(sheet.source, first))));
    const rowY = -(drawn * SIGN_STEP);
    s.position.set(first.offsetX, rowY + first.offsetY);
    node.addChild(s);
    if (rest.length > 0) waving.push({ sprite: s, loop, rowY, shown: first });
    drawn++;
  }
  if (waving.length === 0) return { node };
  const advance = (clock: number): void => {
    for (const row of waving) {
      const { sprite, loop, rowY } = row;
      const frame = waveFrameAt(loop, clock);
      if (frame === row.shown) continue;
      row.shown = frame;
      sprite.texture = textures.unmagnified(textures.get(sheet.source, frame));
      sprite.position.set(frame.offsetX, rowY + frame.offsetY);
    }
  };
  return { node, advance };
}

/** Top of `row`'s placeholder mark in anchor space (+y down): inset into the band `signRowAt` resolves
 *  to that row, so a click on the mark answers with that row. */
function markTop(row: number): number {
  return -SIGN_BAND_BOTTOM - (row + 1) * SIGN_STEP + MARK_INSET;
}

/** Plant the base mark on the ground row 0's band claims, where the decoded sign draws its rock clump.
 *  Unstroked, so the foot stays inside {@link SIGN_BASE_BELOW}. */
function drawPost(g: Graphics): void {
  const top = markTop(0) + MARK_HEIGHT;
  g.rect(-POST_WIDTH / 2, top, POST_WIDTH, SIGN_BASE_BELOW - top).fill({ color: BORDER_COLOR });
}

/** The placeholder stack when no art is decoded: the same rows as the sign chain, a coloured bar per
 *  worker and a rounded one per resident family, so the two read apart. */
export function makePlaceholderStack(rows: readonly DoorBadgeRow[]): Container {
  const c = new Container();
  let drawn = 0;
  for (const row of rows) {
    const g = new Graphics();
    const yTop = markTop(drawn);
    if (drawn === 0) drawPost(g);
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
  return c;
}
