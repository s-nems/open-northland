# Footprint offsets may need the original's odd-row parity shift

**Area:** sim + pipeline · **Priority:** P2

`fullStateBlockAreaCells` (`packages/data/src/footprint.ts`) expands `LogicWalkBlockArea` and
`LogicBuildBlockArea` rows to plain `{dx, dy}` offsets, and every consumer stamps them as
`(ax + dx, ay + dy)` in half-cell node space. The CulturesNation dat-format derivation of the
original `lmwb`/`lmbb` sections instead adds 1 to x whenever the anchor row is odd and the target
row is even (`Cultures2-dat-format/sections/arrays/block.py`), and the project reports that replay
matches the original sections byte-identically. On the staggered lattice a fixed offset otherwise
lands one node to the side, so our landscape footprints anchored on odd rows likely sit half a cell
off the original's. Not yet reproduced locally. Building block areas share the offset convention, so
the same question applies there; doors currently use a named front-of-body approximation, not
extracted offsets, and are unaffected until that changes.

The original also gates each row by valency (`lmlv >= row state`) where we conservatively stamp the
full state; that reading is a named approximation in `fullStateBlockAreaCells` and stays out of
scope here.

## Scope

- Reproduce first: derive walk blocking from `emla` plus landscape block areas with and without the
  shift, and diff both against the decoded `lmwb` of owned maps that anchor asymmetric landscapes on
  odd rows. A local probe, not a committed test.
- If confirmed, apply the shift in one shared place and re-check the consumers that add offsets to
  anchors (resource footprints, app map-collision join, building block areas).

## Verify

The `lmwb` diff probe, unit tests covering odd- and even-row anchors, and the existing golden
scenarios (expect hash moves where footprints previously misaligned).
