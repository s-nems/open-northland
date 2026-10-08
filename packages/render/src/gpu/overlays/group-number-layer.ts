import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import type { EntityKind } from '../../data/scene/draw-item.js';
import { classify, readPosition } from '../../data/scene/snapshot-readers/index.js';
import type { DrawnGeometry, EntityBounds } from '../sprite-pool/index.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The control-group number layer - a tiny label such as `1,3` at the bottom-right corner of each unit bound
 * to a control group. The app decides what each label says; this layer draws the id→label map for the
 * settlers and vehicles the sprite pool drew this frame, so a grouped building and a man resting indoors
 * wear none. The characters are a 3×5 pixel font in world space, crisp at every zoom without a text
 * texture. Artistic choice: the original has no such mark.
 */

/** Lit cells of each character's glyph, top row first; every glyph is five rows tall. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ',': ['.', '.', '.', '#', '#'],
};
const GLYPH_ROWS = 5;
/** World px per glyph cell. */
const CELL = 1;
/** Empty cells between two characters. */
const LETTER_GAP = 1;
/** World px the dark rim extends past each lit cell. */
const RIM = 1;
const DIGIT_COLOUR = 0xf2e8c9;
const RIM_COLOUR = 0x000000;
/** How far right of the sprite's centre line the label starts, at most (world px); a narrower sprite
 *  starts it at its own right edge. */
const CORNER_REACH = 6;
const LABELLED_KINDS: ReadonlySet<EntityKind | null> = new Set(['settler', 'vehicle']);

export interface GroupNumberFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  /** Logical screen pixels per world pixel; zoomed out, a label keeps its unzoomed screen size. */
  readonly zoom?: number;
}

interface LabelNode {
  readonly node: Graphics;
  readonly label: string;
}

export class GroupNumberLayer {
  readonly container = new Container();
  /** One label per on-screen member; rebuilt only when its text changes. */
  private readonly labels = new Map<number, LabelNode>();
  /** Reused scratch of ids drawn this frame, to avoid a per-frame allocation. */
  private readonly seen = new Set<number>();

  /** Reconcile to `labels` (entity id → label): draw one per visible member, retire the rest. A character
   *  without a glyph is skipped. */
  draw(frame: GroupNumberFrame, labels: ReadonlyMap<number, string>, viewport?: Viewport): void {
    this.seen.clear();
    const scale = Math.max(1, 1 / (frame.zoom ?? 1));
    for (const [id, label] of labels) {
      const entity = entityById(frame.snapshot, id);
      if (entity === undefined || !LABELLED_KINDS.has(classify(entity.components))) continue;
      const pos = readPosition(entity.components);
      if (pos === null) continue;
      const raw = tileToScreen(pos.x / ONE, pos.y / ONE);
      if (viewport !== undefined && !isVisible(viewport, raw.x, raw.y)) continue;
      const bounds = frame.drawn.boundsOf(id);
      if (bounds === undefined) continue;

      let entry = this.labels.get(id);
      if (entry === undefined || entry.label !== label) {
        entry?.node.destroy();
        entry = { node: drawLabel(label), label };
        this.container.addChild(entry.node);
        this.labels.set(id, entry);
      }
      const corner = cornerOf(bounds);
      entry.node.position.set(corner.x, corner.y);
      entry.node.scale.set(scale);
      this.seen.add(id);
    }
    retireUndrawn(this.labels, this.seen, (entry) => entry.node.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.labels.clear();
  }
}

/** The label's bottom-left point: the sprite's bottom edge, right of its centre line. */
function cornerOf(bounds: EntityBounds): { x: number; y: number } {
  const centre = (bounds.minX + bounds.maxX) / 2;
  return { x: centre + Math.min(CORNER_REACH, bounds.maxX - centre), y: bounds.maxY };
}

/** One label, its bottom-left corner at the origin: the rim under every lit cell, then the cells. */
function drawLabel(label: string): Graphics {
  const cells: { x: number; y: number }[] = [];
  let column = 0;
  for (const char of label) {
    const rows = GLYPHS[char];
    if (rows === undefined) continue;
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === '#') cells.push({ x: (column + c) * CELL, y: (r - GLYPH_ROWS) * CELL });
      }
    });
    column += (rows[0]?.length ?? 0) + LETTER_GAP;
  }
  const g = new Graphics();
  for (const { x, y } of cells) g.rect(x - RIM, y - RIM, CELL + 2 * RIM, CELL + 2 * RIM);
  g.fill(RIM_COLOUR);
  for (const { x, y } of cells) g.rect(x, y, CELL, CELL);
  g.fill(DIGIT_COLOUR);
  return g;
}
