import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Text, TextStyle } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import type { EntityKind } from '../../data/scene/draw-item.js';
import { classify, readPosition } from '../../data/scene/snapshot-readers/index.js';
import type { DrawnGeometry, EntityBounds } from '../sprite-pool/index.js';
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
/** How far right of the sprite's centre line a lone number starts, at most (world px); a narrower
 *  sprite starts it at its own right edge. */
const CORNER_REACH = 6;
const LABELLED_KINDS: ReadonlySet<EntityKind | null> = new Set(['settler', 'vehicle']);

export interface GroupNumberFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  /** Logical screen pixels per world pixel; zoomed out, a label keeps its unzoomed screen size. */
  readonly zoom?: number;
}

export class GroupNumberLayer {
  readonly container = new Container();
  /** One label per on-screen member; rebuilt only when its text changes. */
  private readonly labels = new Map<number, Text>();
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
      const raw = tileToScreen(pos.x / ONE, pos.y / ONE);
      if (viewport !== undefined && !isVisible(viewport, raw.x, raw.y)) continue;
      const bounds = frame.drawn.boundsOf(id);
      if (bounds === undefined) continue;

      const text = numbers.join(',');
      let label = this.labels.get(id);
      if (label === undefined) {
        label = new Text({ text, style: LABEL_STYLE, resolution: TEXT_RESOLUTION });
        this.container.addChild(label);
        this.labels.set(id, label);
      } else if (label.text !== text) {
        label.text = text;
      }
      placeLabel(label, bounds, numbers.length > 1);
      label.scale.set(scale);
      this.seen.add(id);
    }
    retireUndrawn(this.labels, this.seen, (label) => label.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.labels.clear();
  }
}

/** A lone number stands at the sprite's bottom-right; a list hangs centred under the sprite. */
function placeLabel(label: Text, bounds: EntityBounds, several: boolean): void {
  const centre = (bounds.minX + bounds.maxX) / 2;
  if (several) {
    label.anchor.set(0.5, 0);
    label.position.set(centre, bounds.maxY);
  } else {
    label.anchor.set(0, 1);
    label.position.set(centre + Math.min(CORNER_REACH, bounds.maxX - centre), bounds.maxY);
  }
}
