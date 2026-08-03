import type { FootprintCell, LandscapeBlockArea } from './schema/index.js';

/** Any odd anchor row: only its parity matters. */
const ODD_ROW = 1;

/**
 * The x offset a footprint cell stamps at from an anchor on half-cell row `anchorHy`. Offsets are
 * authored in the even-row frame; odd lattice rows sit half a node to +x, so an odd-row anchor
 * stamping onto an even row (odd `dy`) adds 1 to land on the authored world-space cell. Byte
 * evidence for landscapes only (docs/formats/MAPDAT.md); building footprints and doors share the
 * authored offset schema, so the shift extends to them by convention.
 */
export function footprintCellDx(anchorHy: number, cell: Readonly<FootprintCell>): number {
  return cell.dx + ((anchorHy & 1) !== 0 && (cell.dy & 1) !== 0 ? 1 : 0);
}

/**
 * The largest |x offset| a footprint cell can stamp at over both anchor-row parities: the bound a
 * coverage-radius argument must assume.
 */
export function footprintCellMaxAbsDx(cell: Readonly<FootprintCell>): number {
  return Math.max(Math.abs(cell.dx), Math.abs(footprintCellDx(ODD_ROW, cell)));
}

/**
 * Collapse a `[GfxLandscape]`-style block-area table (`[state, x, y, run]` rows) to the largest
 * state's cells: that state is the full-grown object, and collision stays conservatively static at
 * that size, so a sapling reserves its grown tree's space. Overlapping cells are emitted once.
 */
export function fullStateBlockAreaCells(
  areas: readonly Readonly<LandscapeBlockArea>[] | undefined,
): FootprintCell[] {
  if (areas === undefined || areas.length === 0) return [];
  let fullState = 0;
  for (const [state] of areas) if (state > fullState) fullState = state;
  const seen = new Set<string>();
  const out: FootprintCell[] = [];
  for (const [state, x, y, run] of areas) {
    if (state !== fullState || run <= 0) {
      continue;
    }
    for (let i = 0; i < run; i++) {
      const key = `${x + i},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ dx: x + i, dy: y });
    }
  }
  return out;
}
