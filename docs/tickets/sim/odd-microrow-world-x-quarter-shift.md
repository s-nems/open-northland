# Verify the odd-microrow quarter-cell shift

**Area:** sim, render · **Priority:** P3
**Needs user:** compare odd-row landscape placement with the running original.

Byte-level evidence from the `lmwb` replay (docs/formats/MAPDAT.md) implies the original's world
geometry: block-area offsets are authored in the even-row frame and odd-row anchors shift odd-`dy`
rows one node +x, which is only geometrically consistent if odd micro-rows sit half a node
(a quarter cell, 17 px) further +x than even rows. Two community sources suggest the probe: the
CulturesNation `lmtw` derivation uses a parity-dependent 6-neighbour table (a staggered/hex micro
lattice), and cultures2-gl draws `emla` landscape sprites at `x + (y % 2) * 0.5` half-cells.

Our model is rectangular: `halfCellToScreen` maps node `(hx, hy)` to `x = hx * TILE_HALF_W` with no
row-parity term, and `positionOfNode` subtracts `staggerShift` so a standing entity on an odd-row
node also renders at `hx * 34`. If the original is right, every odd-row map object and every entity
standing on an odd-row node draws 17 px left of the original's spot. Node ADDRESSING (collision,
footprints, placements) is unaffected - the parity shift fix already aligns blocked nodes.

## Scope

- Verify visually first: same map region in the running original vs our renderer (odd-row trees
  against ground texture). cultures2-gl can orient the investigation, but per `docs/SOURCES.md`
  another implementation is not evidence - the original decides.
- If confirmed, decide the seam: either `positionOfNode` keeps column coordinates un-corrected (so
  the position-domain `staggerShift` produces the quarter shift at half-integer rows naturally,
  changing sim Position values and goldens) or the render adds the parity term in
  `halfCellToScreen`/`projectNode` only. The first keeps walking interpolation and standing
  positions consistent; the second is render-local but leaves the sim's world metric a
  parity-blind approximation.
- Movement edge lengths (`world-metric.ts`) inherit the same question (an N/S half-row step is
  physically diagonal on a staggered lattice); treat as a separate follow-up if confirmed - the
  original's own 6+2-direction model needs its own investigation before repricing edges.

## Verify

Side-by-side screenshots of an owned map region with odd-row landscape objects; the armor-parade /
map scenes for regression; golden hashes move only if the sim-side reading is chosen.
