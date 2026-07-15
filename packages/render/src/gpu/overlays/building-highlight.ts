import { Container, Graphics } from 'pixi.js';
import { type ElevationField, projectNode } from '../../data/elevation.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/iso.js';

/**
 * The workplace-assignment highlight overlay: while the player is choosing a workplace for a selected
 * settler, every candidate building's footprint cells are washed green (a slot this settler can take is
 * open) or red (it cannot — full, wrong trade, or not a workplace for this settler). The app decides
 * ok/no per building from the snapshot and hands this layer plain cells; the layer is a pure projection
 * and never calls back into the sim (render contract).
 *
 * Sits above the sprite layer like the geometry-debug overlay so the wash reads over the building art,
 * translucent so the sprite stays visible under it. Rebuilt only on `set` (assignment mode enters/leaves,
 * or a slot fills), never per frame.
 */

/** One half-cell offset from a building's anchor node (the IR footprint's own space). */
export interface BuildingHighlightCell {
  readonly dx: number;
  readonly dy: number;
}

/** One candidate building's highlight: its anchor node, its footprint cells, and whether the settler can
 *  be assigned here (green) or not (red). */
export interface BuildingHighlightItem {
  readonly anchor: { readonly hx: number; readonly hy: number };
  readonly cells: readonly BuildingHighlightCell[];
  readonly ok: boolean;
}

/** The assignable (green) and blocked (red) washes — saturated hues at a moderate alpha, enough to read
 *  the verdict over the building art without hiding it. */
const OK_COLOR = 0x40d060;
const NO_COLOR = 0xd94040;
const FILL_ALPHA = 0.32;
const STROKE_ALPHA = 0.85;

export class BuildingHighlightLayer {
  readonly container = new Container();

  /** Rebuild the overlay from `items` (or clear it with `null`). Node positions ride the shared
   *  {@link projectNode} projection (half-cell, lifted by the terrain height under the node). */
  set(items: readonly BuildingHighlightItem[] | null, elevation?: ElevationField): void {
    for (const child of this.container.removeChildren()) child.destroy();
    if (items === null || items.length === 0) return;
    const g = new Graphics();
    this.container.addChild(g);
    for (const item of items) {
      const color = item.ok ? OK_COLOR : NO_COLOR;
      for (const cell of item.cells) {
        const p = projectNode(elevation, item.anchor.hx + cell.dx, item.anchor.hy + cell.dy);
        diamond(g, p).fill({ color, alpha: FILL_ALPHA }).stroke({ width: 1, color, alpha: STROKE_ALPHA });
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** Path one node's diamond (half the lattice pitch as half-extents), so neighbouring cells interlock
 *  without overlapping — the same diamond the geometry-debug overlay draws. */
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
