import { Container, Graphics, Text } from 'pixi.js';
import type { ElevationField } from '../data/elevation.js';
import { halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../data/iso.js';

/**
 * The BUILDING-GEOMETRY debug overlay (`?debug=geometry`) — draws every placed building's logic
 * geometry over the world so a human can verify the extracted data against the drawn graphic:
 *
 *  - RESERVED cells (build-exclusion zone, `footprint.reserved`) — amber outline diamonds;
 *  - BLOCKED cells (walk collision, `footprint.blocked`) — red filled diamonds;
 *  - the DOOR node (`footprint.door`) — green filled diamond (the settler entry cell);
 *  - the WORKER-ICON anchor (door + the building's worker-icon offset: default one node right,
 *    per-building overrides in the app's `catalog/building-tweaks.ts`) — blue dot;
 *  - the ANCHOR node — white cross (the building's own placement node);
 *  - an optional LABEL under the anchor.
 *
 * A DEBUG tool, not a game surface: it rebuilds its whole (small) scene graph on every `set` and is
 * only fed when the flag is on and the building set changed — never per frame. It sits ABOVE the
 * sprite layer so the cells read over the building art (which is exactly what is being verified);
 * fills stay translucent so the art stays visible under them.
 */

/** One half-cell offset from the item's anchor node (the `FootprintCell` shape, re-declared so
 *  `render` stays plain-data like the rest of its inputs). */
export interface GeometryDebugCell {
  readonly dx: number;
  readonly dy: number;
}

/** One building's geometry, in anchor-relative half-cell offsets (the IR footprint's own space). */
export interface GeometryDebugItem {
  /** The building's anchor NODE on the half-cell lattice. */
  readonly anchor: { readonly hx: number; readonly hy: number };
  /** Walk-collision cells (`footprint.blocked`). */
  readonly blocked: readonly GeometryDebugCell[];
  /** Build-exclusion cells (`footprint.reserved`). */
  readonly reserved: readonly GeometryDebugCell[];
  /** The settler entry cell (`footprint.door`). */
  readonly door?: GeometryDebugCell | undefined;
  /** The worker-icon stack anchor (door + the building's worker-icon offset — the app resolves it). */
  readonly iconAnchor?: GeometryDebugCell | undefined;
  readonly label?: string | undefined;
}

/** Overlay palette — one colour per geometry channel (legend order = z order, back to front). */
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

/** px the label sits below its building's anchor node (clear of the sprite's base). */
const LABEL_DROP = 14;

export class GeometryDebugLayer {
  readonly container = new Container();

  /**
   * Rebuild the overlay from `items` (or clear it with `null`). Node positions ride the same
   * projection as everything else: `halfCellToScreen` lifted by the terrain height under the node.
   */
  set(items: readonly GeometryDebugItem[] | null, elevation?: ElevationField): void {
    for (const child of this.container.removeChildren()) child.destroy();
    if (items === null || items.length === 0) return;
    // One Graphics for all cell diamonds (they batch into a single geometry build), labels on top.
    const g = new Graphics();
    this.container.addChild(g);
    for (const item of items) {
      const at = (cell: GeometryDebugCell): { x: number; y: number } =>
        nodePoint(item.anchor.hx + cell.dx, item.anchor.hy + cell.dy, elevation);
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
        const p = at(item.iconAnchor);
        g.circle(p.x, p.y, 4).fill({ color: ICON_ANCHOR_COLOR, alpha: 0.9 });
      }
      const a = nodePoint(item.anchor.hx, item.anchor.hy, elevation);
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

/** A node's world-px point: the half-cell projection, lifted by the terrain height under it. */
function nodePoint(hx: number, hy: number, elevation: ElevationField | undefined): { x: number; y: number } {
  const p = halfCellToScreen(hx, hy);
  const lift = elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAtNode(hx, hy) : 0;
  return { x: p.x, y: p.y - lift };
}

/**
 * Path one node's diamond: half the lattice pitch as half-extents (nodes sit `TILE_HALF_W` apart in x
 * and `TILE_HALF_H/2` in y), so neighbouring cells' diamonds interlock without overlapping. Read per
 * call (not module consts) so the `?pitch=` live override reaches the overlay too.
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
