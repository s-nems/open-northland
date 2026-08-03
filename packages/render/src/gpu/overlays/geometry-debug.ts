import { footprintCellDx } from '@open-northland/data';
import { Container, Graphics, Text } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';

/**
 * The `?debug=geometry` overlay: every placed building's logic geometry drawn over the world so a human
 * can check the extracted data against the drawn graphic. A debug tool, not a game surface - it rebuilds
 * its whole scene graph on every `set`, which is only called when the flag is on and the building set
 * changed.
 */

/** One half-cell offset from the item's anchor node - the `FootprintCell` shape, re-declared so `render`
 *  stays plain-data. */
export interface GeometryDebugCell {
  readonly dx: number;
  readonly dy: number;
}

/** One building's geometry. The cell channels are authored-frame offsets from the IR footprint - the
 *  overlay applies the odd-row parity shift when drawing, the same way the sim stamps them. `iconAnchor`
 *  is already an absolute node, so it is drawn verbatim. */
export interface GeometryDebugItem {
  /** The building's anchor node on the half-cell lattice. */
  readonly anchor: { readonly hx: number; readonly hy: number };
  /** Walk-collision cells (`footprint.blocked`). */
  readonly blocked: readonly GeometryDebugCell[];
  /** Build-exclusion cells (`footprint.reserved`). */
  readonly reserved: readonly GeometryDebugCell[];
  /** The settler entry cell (`footprint.door`). */
  readonly door?: GeometryDebugCell | undefined;
  /** Door node plus the building's worker-icon offset, resolved by the app. */
  readonly iconAnchor?: { readonly hx: number; readonly hy: number } | undefined;
  readonly label?: string | undefined;
}

const RESERVED_COLOR = 0xe0b040;
const BLOCKED_COLOR = 0xd94040;
const DOOR_COLOR = 0x40d960;
const ICON_ANCHOR_COLOR = 0x40a0e0;
const ANCHOR_COLOR = 0xffffff;

const LABEL_STYLE = {
  fontFamily: 'monospace',
  fontSize: 11,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
} as const;

/** px the label sits below its building's anchor node. */
const LABEL_DROP = 14;

export class GeometryDebugLayer {
  readonly container = new Container();

  /** Rebuild the overlay from `items`; `null` clears it. */
  set(items: readonly GeometryDebugItem[] | null, elevation?: ElevationField): void {
    for (const child of this.container.removeChildren()) child.destroy();
    if (items === null || items.length === 0) return;
    // One Graphics for all cell diamonds (they batch into a single geometry build), labels on top.
    const g = new Graphics();
    this.container.addChild(g);
    for (const item of items) {
      const at = (cell: GeometryDebugCell): { x: number; y: number } =>
        projectNode(
          elevation,
          item.anchor.hx + footprintCellDx(item.anchor.hy, cell),
          item.anchor.hy + cell.dy,
        );
      for (const cell of item.reserved) {
        diamond(g, at(cell)).stroke({ width: 1, color: RESERVED_COLOR, alpha: 0.8 });
      }
      for (const cell of item.blocked) {
        diamond(g, at(cell))
          .fill({ color: BLOCKED_COLOR, alpha: 0.3 })
          .stroke({ width: 1, color: BLOCKED_COLOR, alpha: 0.9 });
      }
      if (item.door !== undefined) {
        diamond(g, at(item.door))
          .fill({ color: DOOR_COLOR, alpha: 0.45 })
          .stroke({ width: 2, color: DOOR_COLOR, alpha: 1 });
      }
      if (item.iconAnchor !== undefined) {
        const p = projectNode(elevation, item.iconAnchor.hx, item.iconAnchor.hy);
        g.circle(p.x, p.y, 4).fill({ color: ICON_ANCHOR_COLOR, alpha: 0.9 });
      }
      const a = projectNode(elevation, item.anchor.hx, item.anchor.hy);
      g.moveTo(a.x - 5, a.y)
        .lineTo(a.x + 5, a.y)
        .moveTo(a.x, a.y - 5)
        .lineTo(a.x, a.y + 5)
        .stroke({ width: 1.5, color: ANCHOR_COLOR, alpha: 0.9 });
      if (item.label !== undefined) {
        const text = new Text({ text: item.label, style: LABEL_STYLE });
        text.anchor.set(0.5, 0);
        text.position.set(a.x, a.y + LABEL_DROP);
        this.container.addChild(text);
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * Half the lattice pitch as half-extents (nodes sit `TILE_HALF_W` apart in x and `TILE_HALF_H/2` in y),
 * so neighbouring cells' diamonds interlock without overlapping.
 */
function diamond(g: Graphics, p: { x: number; y: number }): Graphics {
  const rx = TILE_HALF_W / 2;
  const ry = TILE_HALF_H / 4;
  return g
    .moveTo(p.x, p.y - ry)
    .lineTo(p.x + rx, p.y)
    .lineTo(p.x, p.y + ry)
    .lineTo(p.x - rx, p.y)
    .closePath();
}
