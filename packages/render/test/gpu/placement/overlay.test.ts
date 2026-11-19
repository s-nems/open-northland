import { describe, expect, it } from 'vitest';
import { depthKey } from '../../../src/data/projection/index.js';
import { projectNode } from '../../../src/data/terrain/index.js';
import { PlacementGhostLayer } from '../../../src/gpu/placement/ghost.js';
import {
  bandSides,
  COMPOSITE_RESOLUTION,
  fillGridWash,
  overlayBounds,
  type PlacementOverlayCell,
  SIDE_BLOCKED,
  SIDE_OPEN,
} from '../../../src/gpu/placement/overlay.js';
import { WashGeometry } from '../../../src/gpu/placement/wash-mesh.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { halfCellToScreen, makeElevationField, TILE_HALF_H, TILE_HALF_W } from '../../../src/index.js';

const FLAT = makeElevationField(undefined, 0, 0);

describe('overlayBounds', () => {
  it('covers the band nodes and their overlap-grown diamonds on every side', () => {
    const frame = { minCol: 2, maxCol: 6, minRow: 3, maxRow: 9 };
    const b = overlayBounds(frame, 0);
    // Frame cells are half-cell nodes whose diamonds have half-extents (TILE_HALF_W, TILE_HALF_H/2)
    // grown by a few-px fusing pad, so the box clears every border node's centre by a half-extent and
    // the strict comparison is the pad's own room. An odd row's eastmost node sits a quarter cell further.
    const topLeft = halfCellToScreen(frame.minCol, frame.minRow);
    const bottomRight = halfCellToScreen(frame.maxCol, frame.maxRow | 1);
    expect(b.x).toBeLessThan(topLeft.x - TILE_HALF_W);
    expect(b.x + b.width).toBeGreaterThan(bottomRight.x + TILE_HALF_W);
    expect(b.y).toBeLessThan(topLeft.y - TILE_HALF_H / 2);
    expect(b.y + b.height).toBeGreaterThan(bottomRight.y + TILE_HALF_H / 2);
  });

  it('grows upward by the max terrain lift so a hilltop diamond stays inside the composite', () => {
    const frame = { minCol: 0, maxCol: 3, minRow: 0, maxRow: 3 };
    const LIFT = 160;
    const flat = overlayBounds(frame, 0);
    const lifted = overlayBounds(frame, LIFT);
    expect(flat.y - lifted.y).toBeCloseTo(LIFT, 3);
    expect(lifted.height - flat.height).toBeCloseTo(LIFT, 3);
  });
});

describe('bandSides', () => {
  const band = { minCol: 0, maxCol: 6, minRow: 0, maxRow: 6, reserved: [] };

  it("finds a side's border across the stagger: an odd row's diagonal neighbours stand at col and col + 1", () => {
    const even = bandSides({ ...band, blocked: [{ col: 3, row: 2 }] });
    expect(even.at(3, 2)).toBe(SIDE_BLOCKED);
    expect(even.at(3, 3)).toBe(SIDE_OPEN);
    // Node (3,2) sits between (2,3) and (3,3) of the odd row below it, not (4,3).
    expect([even.borders(2, 3), even.borders(3, 3), even.borders(4, 3)]).toEqual([true, true, false]);

    const odd = bandSides({ ...band, blocked: [{ col: 3, row: 3 }] });
    // Node (3,3) sits between (3,2) and (4,2) of the even row above it, not (2,2).
    expect([odd.borders(2, 2), odd.borders(3, 2), odd.borders(4, 2)]).toEqual([false, true, true]);
  });

  it('counts the node two rows away in the same column, whose cell meets this one at a corner', () => {
    const sides = bandSides({ ...band, blocked: [{ col: 3, row: 2 }] });
    expect([sides.borders(3, 4), sides.borders(3, 0), sides.borders(3, 6)]).toEqual([true, true, false]);
  });

  it("draws no border along the band's own rim, where the nodes past it are not known", () => {
    const blocked = [];
    for (let row = band.minRow; row <= band.maxRow; row++) {
      for (let col = band.minCol; col <= band.maxCol; col++) blocked.push({ col, row });
    }
    const sides = bandSides({ ...band, blocked });
    expect(sides.borders(0, 0)).toBe(false);
    expect(sides.borders(6, 3)).toBe(false);
    expect(sides.borders(6, 6)).toBe(false);
  });
});

describe('fillGridWash', () => {
  const band = { minCol: 0, maxCol: 6, minRow: 0, maxRow: 6 };
  const CENTRE = { col: 3, row: 3 };

  function fill(blocked: readonly PlacementOverlayCell[]) {
    const frame = { ...band, blocked, reserved: [] };
    const bounds = overlayBounds(frame, FLAT.maxLift);
    const shapes = {
      band: new WashGeometry(),
      blocked: new WashGeometry(),
      reserved: new WashGeometry(),
      open: new WashGeometry(),
    };
    fillGridWash(frame, FLAT, bounds, shapes);
    /** Whether a shape set's triangles cover a node's centre. */
    const covers = (shape: WashGeometry, cell: PlacementOverlayCell): boolean => {
      const p = projectNode(FLAT, cell.col, cell.row);
      const x = (p.x - bounds.x) * COMPOSITE_RESOLUTION;
      const y = (p.y - bounds.y) * COMPOSITE_RESOLUTION;
      const at = (vertex: number | undefined, axis: 0 | 1): number =>
        shape.positions[(vertex ?? 0) * 2 + axis] ?? Number.NaN;
      for (let i = 0; i < shape.indexCount; i += 3) {
        const signs = [0, 1, 2].map((corner) => {
          const a = shape.indices[i + corner];
          const b = shape.indices[i + ((corner + 1) % 3)];
          return Math.sign((at(b, 0) - at(a, 0)) * (y - at(a, 1)) - (at(b, 1) - at(a, 1)) * (x - at(a, 0)));
        });
        if (signs.every((s) => s >= 0) || signs.every((s) => s <= 0)) return true;
      }
      return false;
    };
    return { shapes, covers };
  }

  function allBut(skip: (cell: PlacementOverlayCell) => boolean): PlacementOverlayCell[] {
    const cells: PlacementOverlayCell[] = [];
    for (let row = band.minRow; row <= band.maxRow; row++) {
      for (let col = band.minCol; col <= band.maxCol; col++) {
        if (!skip({ col, row })) cells.push({ col, row });
      }
    }
    return cells;
  }

  it('cuts a lone open node, and every node of a one-row strip, out of the blocked ground around it', () => {
    const lone = fill(allBut((c) => c.col === CENTRE.col && c.row === CENTRE.row));
    expect(lone.covers(lone.shapes.open, CENTRE)).toBe(true);
    // The blocked neighbours' padding reaches the open node's centre, which is what the cut is for.
    expect(lone.covers(lone.shapes.blocked, CENTRE)).toBe(true);

    const strip = fill(allBut((c) => c.row === CENTRE.row));
    for (let col = band.minCol; col <= band.maxCol; col++) {
      expect(strip.covers(strip.shapes.open, { col, row: CENTRE.row })).toBe(true);
    }
  });

  it('leaves a lone blocked node its centre while its open neighbours keep theirs', () => {
    const { shapes, covers } = fill([CENTRE]);
    expect(covers(shapes.blocked, CENTRE)).toBe(true);
    expect(covers(shapes.open, CENTRE)).toBe(false);
    for (const neighbour of [
      { col: 2, row: 3 },
      { col: 4, row: 3 },
      { col: 3, row: 2 },
      { col: 4, row: 4 },
      { col: 3, row: 5 },
    ]) {
      expect(covers(shapes.open, neighbour)).toBe(true);
    }
  });
});

describe('PlacementGhostLayer', () => {
  // No sheet, so this takes the placeholder diamond path.
  function makeLayer(): PlacementGhostLayer {
    return new PlacementGhostLayer(undefined, new TextureCache());
  }

  it('is hidden until given a ghost, snaps to the node anchor, and hides again on null', () => {
    const layer = makeLayer();
    expect(layer.container.visible).toBe(false);

    // Ghost col/row are half-cell node coords.
    layer.set({ kind: 'building', col: 5, row: 8, buildingType: 2, tribe: 1 }, FLAT);
    expect(layer.container.visible).toBe(true);
    const p = halfCellToScreen(5, 8);
    expect(layer.container.position.x).toBeCloseTo(p.x, 3);
    expect(layer.container.position.y).toBeCloseTo(p.y, 3);
    // Depth-sorts like a real house standing there, on the pre-lift feet anchor.
    expect(layer.container.zIndex).toBeCloseTo(depthKey(p.x, p.y), 6);

    layer.set(null, FLAT);
    expect(layer.container.visible).toBe(false);
  });

  it('rides the terrain lift at the hovered node (draws up the hill, depth stays pre-lift)', () => {
    const W = 4;
    const H = 12;
    const elev = new Array<number>(W * H).fill(0);
    elev[8 * W + 1] = 160; // a hill under cell (1, 8), which is node (2, 16)'s cell-space point
    const field = makeElevationField(elev, W, H);

    const layer = makeLayer();
    layer.set({ kind: 'building', col: 2, row: 16, buildingType: 2, tribe: 1 }, field);
    const p = halfCellToScreen(2, 16);
    // The lift samples cell space at (col/2, row/2) = the hill cell (1, 8).
    expect(p.y - layer.container.position.y).toBeCloseTo(field.liftAt(1, 8), 3);
    expect(layer.container.zIndex).toBeCloseTo(depthKey(p.x, p.y), 6);
  });
});
