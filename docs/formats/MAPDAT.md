# `map.dat` container

`map.dat` stores the binary landscape grids and placed landscape objects for a map. Its sibling
`map.cif` carries logic headers and authored entity commands.

The facts below come from byte-level comparisons across owned maps, rendered probes, and synthetic
decoder tests. Facts credited to the CulturesNation
[`Cultures2-dat-format`](https://github.com/Mikulus6/Cultures2-dat-format) documentation are marked
as such; everything marked "verified" was re-checked against the owned corpus (130 map files, 5184
chunks). [`SOURCES.md`](../SOURCES.md#evidence-baseline) defines that corpus.

## Chunk stream

The file is a sequence of `hoix` chunks. Each chunk has a 32-byte little-endian header followed by
its payload:

```text
+0x00 u32 marker       # 0x78696F68, bytes "hoix"
+0x04 u32 id           # four-character subtag
+0x08 u32 version      # constant per tag: 0 group/terminator, 1 default, 2 `lafm`, 4 `lasw` (verified)
+0x0C u32 length
+0x10 u32 depth        # 0 on every chunk of the owned corpus (verified)
+0x14 u32 checksum     # of the payload, algorithm below
+0x18 u32 reserved
+0x1C u32 reserved
```

Zero-length group chunks delimit nested sections. `lsiz` is an unpacked pair of `u32` values for
width and height. Grid lanes are packed byte or word planes. Their RLE control byte uses the high bit
for a repeated run and a clear high bit for a literal run. Decoding stops at the declared output
length.

## Payload checksum

The `+0x14` field is a rolling checksum of the payload. Zero-length chunks store 0, not the
pseudocode's empty-input value. The constants follow the CulturesNation documentation; the algorithm
is verified against every chunk of the owned corpus:

```text
sum = 0; a = 1695929585; b = 1876105387; c = 1677611962    # all u32 arithmetic
for each payload byte v at index i:
    sum = (sum << 8) | v
    if i % 4 == 3: a = a ^ b ^ sum; b = (b ^ sum) + c
checksum = sum ^ a
```

The decoder does not validate it. Whether the original engine validates it on load is unverified;
every owned chunk carries a matching value, so a writer targeting the original engine should fill it
in.

## Grid resolutions

- Cell lanes contain `width * height` values.
- Half-cell lanes contain `(2 * width) * (2 * height)` values.
- A/B ground lanes describe the two triangles rendered inside each cell.

The simulation uses the half-cell lattice directly. Cell `(column, row)` maps to node
`(2 * column + (row & 1), 2 * row)`.

## Lanes emitted by the pipeline

| Tag | Stored resolution | Current use |
| --- | --- | --- |
| `lmhe` | cell | elevation |
| `embr` | cell | terrain brightness |
| `lmlt` | half-cell | collapsed to cell landscape logic ids |
| `lmlv` | half-cell | landscape valency: each placement's growth level |
| `empa`, `empb` | cell triangles | final ground-pattern ids |
| `emla` | half-cell | placed landscape-object ids |
| `emt1` to `emt4` | cell | transition overlay ids and variants |
| `lmms` | half-cell | max moveable-unit size per the CulturesNation docs: distance from blocked nodes capped at 7 (range verified); collapsed to the cell `shore` lane |

The loader also exposes per-lane dimensions and dictionaries needed to resolve numeric ids.

## Lanes not imported

The remaining chunks are dropped on import. Meanings below follow the CulturesNation documentation,
which reports replaying each derivable section byte-identically against original maps; of these the
`lmwb`/`lmbb` and `lmtw` derivations are independently verified here (see below). "Derivable" sections
can be recomputed from the imported lanes plus landscape data; "authored" ones carry map content we
currently lose.

Treat these meanings as probe targets, not implementation evidence, until they are re-checked.

| Tag | Kind | Meaning |
| --- | --- | --- |
| `lmpa`, `lmpb` | derivable | pattern `LogicType` per triangle (water = 1, void = {0, 5, 6}, land = rest) |
| `lmco`, `laco` | derivable | flood-filled continent id per node, plus the continent table (type, anchor, size) |
| `lmtw` | derivable | per-node passability bits for the 6 lattice edge directions (derivation verified below) |
| `lmpr` | derivable | roughness 0..5 slowing movement; 1 on water and road nodes |
| `lmwb`, `lmbb` | derivable | landscape walk/build blocking stamped from `emla` block areas (derivation verified below) |
| `lmro`, `lmsb`, `lmhf`, `emm1` | derivable | road presence, walk-sector point marks, zeros, road-overlay visibility |
| `lmao` | derivable | attach-point vector per node, encoded `(-dx - (dy << 8)) & 0xffff` |
| `lasw` | derivable | pathfinding sector graph: 10x10-cell sectors, land and water planes, 52 bytes each |
| `emmi` | authored | road-overlay type per half-cell node |
| `lmlp` | authored | owner and palette of pre-placed stockades and gates per node |
| `lafm` | authored | fish swarms: fixed 500-slot table of position, count, continent |
| `emvc` | authored | vertex colors per cell (optional chunk, like `lmhf`) |

Ground collision currently joins `empa` and `empb` through `gfxPatterns` to
`trianglePatternTypes`. Imported maps already contain their final ground patterns and transition
overlays, so the renderer does not invent a terrain-transition algorithm.

Landscape objects from `emla` are anchored on half-cell nodes. Their blocking offsets are stamped at
that resolution before the terrain graph reaches placement and pathfinding.

### Verified `lmwb`/`lmbb` derivation (byte-level, owned corpus)

Replaying `lmwb` from `emla` + `lmlv` + the `landscapes.cif` block areas reproduces the owned maps
byte-identically (129 of 130 decodable maps; the single residual bit is a provably stale cell where
the map swapped a blocking object for its non-blocking variant after the section was computed). The
verified stamp rule, per placement at half-cell `(x, y)` and per block-area row `[state, dx, dy, run]`:

- rows are gated cumulatively by valency: a row stamps when `lmlv[y][x] >= state` (so a full-grown
  object stamps every state's rows, a sapling only its lowest);
- each row stamps `run` nodes starting at `(x + dx, y + dy)` along +x, clipped to the grid;
- **odd-row parity shift**: when the anchor row `y` is odd and the target row `y + dy` is even, the
  whole row lands one node further +x. That stamp rule is the verified fact; the consistent
  geometric READING - offsets authored in the even-row frame, odd lattice rows half a node to +x
  (matching `lmtw`'s parity-dependent 6-neighbour table) - is an interpretation, not yet verified
  visually against the running original.

`lmbb` follows the same rule; it replays byte-identically on most maps, with residues consistent with
stale sections (several maps carry an empty or outdated `lmbb`). The engine's runtime stamping is what
the sim mirrors (`footprintCellDx` in `packages/data`); the conservative full-state collapse
(`fullStateBlockAreaCells`) remains a named approximation of the valency gate.

### Verified `lmtw` derivation: ground walkability is per triangle, and land wins

Replaying `lmtw` from `empa`/`empb` alone reproduces all 130 decodable owned maps byte-identically,
which settles how the original classes ground under a mixed cell. Each of the `2W x 2H` lattice nodes
takes a type from the triangles touching it, by priority `land > void > water`, where land is every
`trianglepatterntypes` row with `humancanwalkon 1`, water is the `iswater` row, and void is the rest
plus the row-less `border` type. An edge between two nodes carries its direction bit when both nodes
and the triangles tangent to that edge resolve to the same type. The outer band is unconditionally
impassable: 4 node rows top and bottom, and 3 to 5 node columns per side depending on `y % 4`.

So one blocking triangle never seals its cell: every node the cell's walkable triangle touches is a
land node. The 124 decoded maps paint 58738 cells with exactly one walkable triangle (43664 mixed
with water, 7733 with moor, 7341 with `border`, which is also the interior void filler and not only
the frame band), so shoreline and void margins drawn out of them walk in the original.

### How `content/collision.ts` approximates it

The join keeps ground classes at cell resolution and mirrors the node rule per flag: better triangle
for walking, worse for building and sowing. Two named gaps, measured against the replayed `lmtw`
components over the same 124 maps:

- **Permissive inside a mixed cell.** A walkable triangle opens all four of the cell's nodes, not
  just the ones it touches, so a mixed cell is a 4-node crossing rather than a 3-node one. On 17 maps
  that attaches one pocket of 202 to 556 nodes to a mainland the original keeps separate. On every
  other map, and for every larger region, each of our components falls inside a single `lmtw`
  component: the join never welds two landmasses the original holds apart.
- **Restrictive at a fully blocking cell.** Its nodes are impassable here even where a neighbouring
  cell's walkable triangle touches them, and the unconditional outer band is not implemented at all.

The worst-triangle collapse this replaced was wrong in the other direction and by more: it split
landmasses the original's own `lmtw` joins, on 7 of the maps sampled.

## Tests

Container, dictionary, packed-layer, terrain, and conversion tests build synthetic chunk streams.
`npm run test:pipeline` checks real map dimensions, joins, lane sizes, and generated output against the
owned input corpus without committing a map file.
