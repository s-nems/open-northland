import { type ContentSet, footprintCellMaxAbsDx, fullStateBlockAreaCells } from '@open-northland/data';

/**
 * The largest |dx|+|dy| any `landscapeGfx` work-area cell can stamp at from its record's anchor, taken
 * worst-case over the odd-row parity shift and floored at 3, which covers the lattice's widest step.
 */
export function maxWorkCellOffset(content: ContentSet): number {
  let max = 3;
  for (const record of content.landscapeGfx) {
    for (const cell of fullStateBlockAreaCells(record.workAreas)) {
      const offset = footprintCellMaxAbsDx(cell) + Math.abs(cell.dy);
      if (offset > max) max = offset;
    }
  }
  return max;
}
