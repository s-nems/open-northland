# Decode a UTF-8 briefing file as UTF-8

**Area:** pipeline · **Focus:** `tools/asset-pipeline/src/decoders/ini` · **Priority:** P3

`decodeIni` (`tools/asset-pipeline/src/decoders/ini/grammar.ts`) decodes every readable text file as
CP1250, the codepage the original authored in. A third-party map authored in UTF-8 comes out as
mojibake in its name sidecar and its briefing, and reaches the map list and mission sheet that way:
`Tale_of_Six_Sons_MULTIPLAYER` (a user-installed map, not part of the CnMod corpus) renders
"LEGENDA SZEĹšCIU SYNĂ“W" for "LEGENDA SZEŚCIU SYNÓW". Every mod map and history book is clean, so
the mod-only pipeline shows no hit; a `UserMaps/` map authored in UTF-8 does.

## Scope

- Detect UTF-8 text at the byte level (a BOM, or a strict UTF-8 decode that succeeds over bytes CP1250
  would map to the mojibake range) and decode it as UTF-8; everything else stays CP1250.
- Keep the decision at the decoder seam so briefings, `.hlt` pages and rule files share it.

## Verify

- Unit test over both byte sequences of one Polish line: CP1250 and UTF-8 decode to the same string.
- `npm run test:pipeline`, then grep the emitted `.meta.json` and `.briefing.json` sidecars for the
  mojibake range: zero hits, including with a UTF-8 map dropped into the mod root's `UserMaps/`.
