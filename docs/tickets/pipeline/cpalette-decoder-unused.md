# Decide the fate of the standalone `CPalette` decoder

**Area:** pipeline · **Origin:** data+pipeline refactor review, 2026-07-13 · **Priority:** P3
**Needs user:** keep-vs-delete is a product-scope call (the decoder may be deliberately staged for
the `.hlt`/remap work) — get the owner's decision before executing.

`tools/asset-pipeline/src/decoders/palette.ts` — `decodePalette`/`encodePalette` (the standalone
`CPalette` storable, id 0x3F6: an 8-byte header + a 0x400-byte `[B,G,R,_]` body) are referenced
**only** by `test/palette.test.ts`. No `src/stages/*` consumes them: the stages use the `.pcx` trailer
palette (`decodePcx(...).palette`) and `player-palette.ts` instead. So the decoder is dead-in-pipeline.

## Why this is a decision, not a drop-in delete

Two readings, both plausible:

- **Dead code** — per AGENTS.md "delete dead code; git history is the archive", remove `palette.ts` +
  its test. The `.cif`/`.pcx`/`.bmd` palette paths already cover every palette the pipeline reads.
- **Deliberately staged** — the `CPalette` storable is real game data (standalone `.pal`-style
  palettes and the `.hlt` remap tables the map/GUI work may need), and the decoder was written ahead of
  its consumer as a faithful round-tripped format decoder (like the other encoder/decoder pairs). The
  pipeline's stage-order comment historically listed "Decode palettes + .hlt remap tables" as a TODO.

Needs an owner decision. If kept, add a one-line note in `palette.ts` naming the intended future
consumer so it doesn't keep reading as dead; if dropped, delete the decoder + its test in the same
commit.

## Verify

If deleted: `npm test`, `npm run check`, `npm run build` stay green (nothing else imports it). If kept:
no code change beyond the provenance note.

## Source basis

`CPalette` layout is OpenVikings-pinned (`CPalette.cs`); this ticket is about product scope, not format
correctness.
