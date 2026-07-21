# `map.dat` container

`map.dat` stores the binary landscape grids and placed landscape objects for a map. Its sibling
`map.cif` carries logic headers and authored entity commands.

The facts below come from byte-level comparisons across owned maps, rendered probes, and synthetic
decoder tests.

## Chunk stream

The file is a sequence of `hoix` chunks. Each chunk has a 32-byte little-endian header followed by
its payload:

```text
+0x00 u32 marker       # 0x78696F68, bytes "hoix"
+0x04 u32 id           # four-character subtag
+0x08 u32 version
+0x0C u32 length
+0x10 u32 depth
+0x14 u32 checksum
+0x18 u32 reserved
+0x1C u32 reserved
```

Zero-length group chunks delimit nested sections. `lsiz` is an unpacked pair of `u32` values for
width and height. Grid lanes are packed byte or word planes. Their RLE control byte uses the high bit
for a repeated run and a clear high bit for a literal run. Decoding stops at the declared output
length.

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
| `empa`, `empb` | cell triangles | final ground-pattern ids |
| `emla` | half-cell | placed landscape-object ids |
| `emt1` to `emt4` | cell | transition overlay ids and variants |
| `lmms` | half-cell | collapsed to a cell `shore` lane; meaning not yet confirmed or consumed |

The loader also exposes per-lane dimensions and dictionaries needed to resolve numeric ids. `lmpa`,
`lmpb`, `lmtw`, and `lmco` are not part of the current terrain output path.

Ground collision currently joins `empa` and `empb` through `gfxPatterns` to
`trianglePatternTypes`. Imported maps already contain their final ground patterns and transition
overlays, so the renderer does not invent a terrain-transition algorithm.

Landscape objects from `emla` are anchored on half-cell nodes. Their blocking offsets are stamped at
that resolution before the terrain graph reaches placement and pathfinding.

## Tests

Container, dictionary, packed-layer, terrain, and conversion tests build synthetic chunk streams.
`npm run test:pipeline` checks real map dimensions, joins, lane sizes, and generated output against the
owned input corpus without committing a map file.
