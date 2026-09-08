# Decode a UTF-8 briefing file as UTF-8

**Area:** pipeline · **Focus:** `tools/asset-pipeline/src/decoders/ini` · **Priority:** P3

`decodeIni` (`tools/asset-pipeline/src/decoders/ini/grammar.ts`) decodes every readable text file as
CP1250, the codepage the original authored in. One mod map ships its briefing as UTF-8 instead, so its
bytes come out as mojibake and reach the mission sheet that way: `tale_of_six_sons_multiplayer`'s Polish
intro renders "LEGENDA SZEĹšCIU SYNĂ“W" for "LEGENDA SZEŚCIU SYNÓW". One of the 123 emitted briefing
sidecars is affected; the history books and every other map are clean.

## Scope

- Detect UTF-8 text at the byte level (a BOM, or a strict UTF-8 decode that succeeds over bytes CP1250
  would map to the mojibake range) and decode it as UTF-8; everything else stays CP1250.
- Keep the decision at the decoder seam so briefings, `.hlt` pages and rule files share it.

## Verify

- Unit test over both byte sequences of one Polish line: CP1250 and UTF-8 decode to the same string.
- `npm run test:pipeline`, then grep the emitted briefing sidecars for the mojibake range: zero hits.
