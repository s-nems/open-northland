# Graphics containers

Open Northland decodes the original palette-indexed pictures, sprite animations, bitmap fonts, and
cursor resources into local browser-ready content.

## PCX pictures

The PCX decoder reads the 128-byte header, expands scanline RLE, respects `bytesPerLine` padding, and
uses the trailing 256-color RGB palette when present. Indexed pixels remain indexed until the atlas or
picture stage applies a palette.

PCX is a published format. Tests use small synthetic pictures with padding, RLE runs, literal bytes,
and palette trailers.

## Palettes

The game's stored 256-color palette body is 1,024 bytes: 256 entries in `B, G, R, reserved` order.
PCX palette trailers instead store three-byte `R, G, B` entries. The pipeline keeps those layouts
separate and converts both to a common RGBA representation.

Player colors, GUI elements, fonts, and some building families use palette lookup textures rather than
duplicated RGBA atlases.

A human draws its body and head bobs through two palettes, each starting from the base its
`[jobbasegraphics]` record names for that half (`gfxpalettebasebody`, `gfxpalettebasehead`). A
`randompalette.ini` `Patch <id> <ramp|patch> <weight>` line overwrites one 16-entry band: id 0..15
addresses body band `id`, 16..31 head band `id - 16`, and a numeric source copies the band it names in
the same way; the weights of one id's lines are summed and rolled, and lines apply in file order
(original behavior). The `player_NN` and `woman_NN` recipes patch body bands
only, so a head never carries the team ramp. The human `*_Base` recipes roll the eyebrows (head band 5)
from the already rolled hair band (`Patch 21 20 35`) against a lighter blond or face-skin option;
`Egy_Soldier_Base` leaves them at the base.

## Bob animations (`.bmd`)

A bob manager contains frame records, line-control words, and packed scanline data. A frame record
provides its local area, type, and first line-control index.

Each non-empty scanline begins at an encoded x coordinate and packed-data offset. The packed data is a
sequence of control bytes terminated by zero:

- high bit clear: copy the following `count` pixel values;
- high bit set: skip `count` transparent pixels.

Frame types select one-byte indexed pixels, mask pixels, or two-byte indexed values carrying alpha or
construction-time thresholds. A 1-bit mask frame (type 2: the shadow silhouettes) is the exception:
its raw runs carry no pixel bytes at all, the run itself being the coverage (pinned on the real shadow
`.bmd`s, which only decode into coherent silhouettes this way). The decoder emits parallel pixel and
opacity arrays, plus a time array when required. Palette application and atlas packing are separate
stages.

Synthetic tests cover container parsing, packed runs, empty lines, masks, time bytes, clipping, atlas
placement, and round trips. Real visual validation compares decoded frames in the browser galleries.

## Bitmap fonts (`.fnt`)

A font file wraps a bob manager with a small font header. Character byte `c` addresses bob
`c - 0x20`. Metrics are derived from each glyph's stored rectangle and draw offset; empty slots have
zero extent. The content layer keeps the byte-oriented codepage associated with the consuming language.

## Windows cursors (`.cur`)

Cursor files use the standard Windows icon-directory structure with DIB images and AND masks. The
pipeline preserves the original cursor for CSS use and emits a PNG preview plus hotspot metadata.

## Local output

Decoded atlases, indexed textures, palette lookup tables, font metrics, cursors, and manifests are
written under `content/`. None of those generated files belongs in Git.
