import type { FootprintCell, LandscapeBlockArea } from './schema/index.js';

/** The representative odd anchor row for {@link footprintCellMaxAbsDx}'s worst-case probe. */
const ODD_ROW = 1;

/**
 * The x offset a footprint cell stamps at from an anchor on half-cell row `anchorHy`. Offsets are
 * authored in the even-row frame; odd lattice rows sit half a node to +x, so an odd-row anchor
 * stamping onto an even row (odd `dy`) adds 1 to land on the authored world-space cell. Source
 * basis: the original `lmwb` sections replay byte-identically from `emla` + landscape block areas
 * across the owned map corpus with this shift and on no map without it (docs/formats/MAPDAT.md).
 * Building footprints and doors share the authored offset schema, so the shift extends to them by
 * convention - byte-verified only for landscapes.
 */
export function footprintCellDx(anchorHy: number, cell: Readonly<FootprintCell>): number {
  return cell.dx + ((anchorHy & 1) !== 0 && (cell.dy & 1) !== 0 ? 1 : 0);
}

/**
 * The largest |x offset| a footprint cell can stamp at over both anchor-row parities - the bound a
 * Chebyshev/Manhattan coverage argument must assume, since an odd-`dy` cell reaches one node further
 * +x from an odd anchor row ({@link footprintCellDx}).
 */
export function footprintCellMaxAbsDx(cell: Readonly<FootprintCell>): number {
  return Math.max(Math.abs(cell.dx), Math.abs(footprintCellDx(ODD_ROW, cell)));
}

/**
 * Collapse a `[GfxLandscape]`-style block-area table (`[state, x, y, run]` rows - the shape
 * `LogicWalkBlockArea`/`LogicBuildBlockArea` decode to) to the full state's cells: the largest state
 * index is the fresh/full-grown object, and collision is conservatively static at that size (a
 * sapling reserves its grown tree's space). The one shared reading of the state axis - the sim's
 * resource footprints and the app's map-collision join both class by it, so the rule cannot drift
 * between them. Duplicate cells (overlapping run rows) are emitted once; non-positive runs contribute
 * nothing.
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
