# `map.dat` container

`map.dat` stores the binary landscape grids and placed landscape objects for a map. Its sibling
`map.cif` carries logic headers and authored entity commands.

The facts below come from byte-level comparisons across owned maps, rendered probes, and synthetic
decoder tests. Facts credited to the CulturesNation
[`Cultures2-dat-format`](https://github.com/Mikulus6/Cultures2-dat-format) documentation are marked
as such; everything marked "verified" was re-checked against the owned corpus (130 map files, 5184
chunks).

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
which reports replaying each derivable section byte-identically against original maps; none of them
is independently verified here yet. "Derivable" sections can be recomputed from the imported lanes
plus landscape data; "authored" ones carry map content we currently lose.

| Tag | Kind | Meaning |
| --- | --- | --- |
| `lmpa`, `lmpb` | derivable | pattern `LogicType` per triangle (water = 1, void = {0, 5, 6}, land = rest) |
| `lmco`, `laco` | derivable | flood-filled continent id per node, plus the continent table (type, anchor, size) |
| `lmtw` | derivable | per-node passability bits for the 6 lattice edge directions |
| `lmpr` | derivable | roughness 0..5 slowing movement; 1 on water and road nodes |
| `lmwb`, `lmbb` | derivable | landscape walk/build blocking stamped from `emla` block areas |
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

## Tests

Container, dictionary, packed-layer, terrain, and conversion tests build synthetic chunk streams.
`npm run test:pipeline` checks real map dimensions, joins, lane sizes, and generated output against the
owned input corpus without committing a map file.
