import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import { readPosition } from '../../data/scene/snapshot-readers/index.js';
import type { DrawnGeometry, EntityBounds } from '../sprite-pool/index.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The control-group number layer - a small digit at the top-right corner of each unit bound to one of the
 * first control groups. The app decides which numbers show; this layer draws the id→number map for the
 * members the sprite pool drew this frame, so a man resting indoors wears none. Like the life hearts it
 * paints over a building the unit walks behind. The digits are a 3×5 pixel font in world space, crisp at
 * every zoom without a text texture. Artistic choice: the original has no such mark.
 */

/** Lit cells of each digit's 3×5 glyph, top row first. */
const GLYPHS: Readonly<Record<number, readonly string[]>> = {
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
};
/** World px per glyph cell. */
const CELL = 2;
/** World px the dark rim extends past each lit cell. */
const RIM = 1;
const DIGIT_COLOUR = 0xf2e8c9;
const RIM_COLOUR = 0x000000;
/** How far right of the sprite's centre line the digit stands, at most (world px); a narrower sprite
 *  puts it at its own right edge. */
const CORNER_REACH = 12;

export interface GroupNumberFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  /** Logical screen pixels per world pixel; zoomed out, a digit keeps its unzoomed screen size. */
  readonly zoom?: number;
}

interface DigitNode {
  readonly node: Graphics;
  readonly digit: number;
}

export class GroupNumberLayer {
  readonly container = new Container();
  /** One digit per on-screen member; rebuilt only when its number changes. */
  private readonly digits = new Map<number, DigitNode>();
  /** Reused scratch of ids drawn this frame, to avoid a per-frame allocation. */
  private readonly seen = new Set<number>();

  /** Reconcile to `numbers` (entity id → group number): draw one digit per visible member, retire the
   *  rest. A number without a glyph draws nothing. */
  draw(frame: GroupNumberFrame, numbers: ReadonlyMap<number, number>, viewport?: Viewport): void {
    this.seen.clear();
    const scale = Math.max(1, 1 / (frame.zoom ?? 1));
    for (const [id, digit] of numbers) {
      const glyph = GLYPHS[digit];
      if (glyph === undefined) continue;
      const entity = entityById(frame.snapshot, id);
      const pos = entity === undefined ? null : readPosition(entity.components);
      if (pos === null) continue;
      const raw = tileToScreen(pos.x / ONE, pos.y / ONE);
      if (viewport !== undefined && !isVisible(viewport, raw.x, raw.y)) continue;
      const bounds = frame.drawn.boundsOf(id);
      if (bounds === undefined) continue;

      let entry = this.digits.get(id);
      if (entry === undefined || entry.digit !== digit) {
        entry?.node.destroy();
        entry = { node: drawGlyph(glyph), digit };
        this.container.addChild(entry.node);
        this.digits.set(id, entry);
      }
      const corner = cornerOf(bounds);
      entry.node.position.set(corner.x, corner.y);
      entry.node.scale.set(scale);
      this.seen.add(id);
    }
    retireUndrawn(this.digits, this.seen, (entry) => entry.node.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.digits.clear();
  }
}

/** The digit's top-left point: the sprite's top edge, right of its centre line. */
function cornerOf(bounds: EntityBounds): { x: number; y: number } {
  const centre = (bounds.minX + bounds.maxX) / 2;
  return { x: centre + Math.min(CORNER_REACH, bounds.maxX - centre), y: bounds.minY };
}

/** One digit, its glyph box's top-left corner at the origin: the rim under every lit cell, then the
 *  cells. */
function drawGlyph(rows: readonly string[]): Graphics {
  const g = new Graphics();
  const cells: { x: number; y: number }[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') cells.push({ x: c * CELL, y: r * CELL });
  });
  for (const { x, y } of cells) g.rect(x - RIM, y - RIM, CELL + 2 * RIM, CELL + 2 * RIM);
  g.fill(RIM_COLOUR);
  for (const { x, y } of cells) g.rect(x, y, CELL, CELL);
  g.fill(DIGIT_COLOUR);
  return g;
}
