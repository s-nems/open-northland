import { type ContentSet, footprintCellMaxAbsDx, fullStateBlockAreaCells } from '@open-northland/data';

/**
 * The largest |dx|+|dy| any `landscapeGfx` work-area cell can STAMP at from its record's anchor (the
 * full-state reading `resourceWorkCell` places collectors by, worst-case over the odd-row parity
 * shift), floored at 3 - see
 * {@link import('../content-index.js').ContentIndex.maxResourceWorkOffset} for the fallback-coverage argument.
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
