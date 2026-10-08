import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Text, TextStyle } from 'pixi.js';
import { isVisible, ONE, tileToScreenX, tileToScreenY, type Viewport } from '../../data/projection/index.js';
import type { EntityKind } from '../../data/scene/draw-item.js';
import { classify, readPosition } from '../../data/scene/snapshot-readers/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The control-group number layer - a tiny label of the groups each unit is bound to: one number at its
 * bottom-right corner, several comma-joined and centred under it. The app decides which numbers a unit
 * lists; this layer draws them for the settlers and vehicles the sprite pool drew this frame, so a grouped
 * building and a man resting indoors wear none. Artistic choice: the original has no such mark.
 */

/** World px of the label's font. */
const FONT_SIZE = 7;
/** A thin sans; the menu's face when the document has it, a system one otherwise. */
const FONT_FAMILY = '"Alegreya Sans", "Helvetica Neue", Arial, sans-serif';
/** Texture pixels per world px, enough for a zoomed-in view on a high-density display. */
const TEXT_RESOLUTION = 8;
const LABEL_STYLE = new TextStyle({
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  fontWeight: '400',
  fill: 0xf2e8c9,
  // A soft dark halo instead of a stroke, which would thicken the thin strokes it rims.
  dropShadow: { color: 0x000000, alpha: 0.9, blur: 1.5, distance: 0, angle: 0 },
});
/** How far right of the feet a lone number starts (world px). */
const CORNER_REACH = 12;
/** How far below the feet a list hangs (world px). */
const FEET_GAP = 1;
const LABELLED_KINDS: ReadonlySet<EntityKind | null> = new Set(['settler', 'vehicle']);

export interface GroupNumberFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  /** Logical screen pixels per world pixel; zoomed out, a label keeps its unzoomed screen size. */
  readonly zoom?: number;
}

interface Label {
  readonly text: Text;
  /** The list {@link text} was written from; the app's lists keep their identity until a group changes. */
  numbers: readonly string[];
}

export class GroupNumberLayer {
  readonly container = new Container();
  /** One label per on-screen member; rewritten only when its list changes. */
  private readonly labels = new Map<number, Label>();
  /** Reused scratch of ids drawn this frame, to avoid a per-frame allocation. */
  private readonly seen = new Set<number>();

  /** Reconcile to `groups` (entity id → its group numbers): draw one label per visible member, retire
   *  the rest. */
  draw(frame: GroupNumberFrame, groups: ReadonlyMap<number, readonly string[]>, viewport?: Viewport): void {
    this.seen.clear();
    const scale = Math.max(1, 1 / (frame.zoom ?? 1));
    for (const [id, numbers] of groups) {
      if (numbers.length === 0) continue;
      const entity = entityById(frame.snapshot, id);
      if (entity === undefined || !LABELLED_KINDS.has(classify(entity.components))) continue;
      const pos = readPosition(entity.components);
      if (pos === null) continue;
      const col = pos.x / ONE;
      const row = pos.y / ONE;
      if (viewport !== undefined && !isVisible(viewport, tileToScreenX(col, row), tileToScreenY(row)))
        continue;
      // The drawn feet rather than the sprite box, which sways with a stride or a swing.
      const feet = frame.drawn.anchorOf(id);
      if (feet === undefined) continue;

      let label = this.labels.get(id);
      if (label === undefined) {
        const text = new Text({ text: numbers.join(','), style: LABEL_STYLE, resolution: TEXT_RESOLUTION });
        this.container.addChild(text);
        label = { text, numbers };
        this.labels.set(id, label);
      } else if (label.numbers !== numbers) {
        const written = numbers.join(',');
        if (label.text.text !== written) label.text.text = written;
        label.numbers = numbers;
      }
      placeLabel(label.text, feet, numbers.length > 1);
      label.text.scale.set(scale);
      this.seen.add(id);
    }
    retireUndrawn(this.labels, this.seen, (label) => label.text.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.labels.clear();
  }
}

/** A lone number stands right of the feet; a list hangs centred under them. */
function placeLabel(label: Text, feet: { readonly x: number; readonly y: number }, several: boolean): void {
  if (several) {
    label.anchor.set(0.5, 0);
    label.position.set(feet.x, feet.y + FEET_GAP);
  } else {
    label.anchor.set(0, 1);
    label.position.set(feet.x + CORNER_REACH, feet.y);
  }
}
