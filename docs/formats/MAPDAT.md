# `map.dat` container

`map.dat` contains the binary landscape grid and placed landscape objects for a map. Its sibling
`map.cif` contains the readable logic header and authored entity commands.

The layout and lane meanings below come from byte-level comparison across legally obtained maps,
rendered lane probes, and synthetic round-trip tests.

## Chunk stream

The file is a sequence of `hoix` chunks. Each chunk has a 32-byte little-endian header followed by its
payload:

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

Zero-length group chunks bracket nested sections. The landscape group precedes the entity/object-map
group, followed by an end marker.

`lsiz` is an unpacked eight-byte payload containing `u32 width` and `u32 height`. Other grid lanes are
RLE-packed byte or word planes. The packed stream uses a control byte: high bit set means a repeated
value, high bit clear means a literal run. Decoding stops at the declared unpacked length.

## Grid resolutions

Map lanes do not all use the same resolution:

- cell lanes contain `width × height` values;
- half-cell lanes contain `(2 × width) × (2 × height)` values;
- the A/B ground and transition lanes describe the two rendered triangles of each cell.

The simulation uses the half-cell lattice directly. Cell `(column, row)` maps to node
`(2 × column + (row & 1), 2 × row)`.

## Consumed lanes

| Tag | Resolution | Meaning |
| --- | --- | --- |
| `lmhe` | cell | elevation |
| `embr` | cell | brightness/shading |
| `lmlt` | half-cell | logic landscape-object type |
| `lmpa`, `lmpb` | cell triangles | logic ground class |
| `empa`, `empb` | cell triangles | final ground-pattern dictionary index |
| `emla` | half-cell | placed landscape-object dictionary index |
| `emt1`…`emt4` | cell triangles | transition-overlay dictionary index and variant |
| `lmms` | map lane | water-depth and shore bands |
| `lmtw` | map lane | coast-transition codes |
| `lmco` | map lane | connected land/region ids |

The map already stores final ground-pattern choices and transition overlays. Imported maps therefore
do not need a newly invented terrain-transition algorithm.

Landscape objects in `emla` are anchored on half-cell nodes. Their walk-block offsets are stamped at
that resolution before the graph is exposed to simulation commands, footprints, and pathfinding.

## Tests

Container, dictionary, packed-layer, terrain, and map-conversion tests synthesize the required chunk
streams. Real pipeline runs compare map dimensions, dictionary joins, lane sizes, and rendered results
without committing a map file.
