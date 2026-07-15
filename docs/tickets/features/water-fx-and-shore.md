# Investigate fx-wave records and shore-band fidelity (defer-with-evidence allowed)

**Area:** app + pipeline · **Origin:** map-visual-fidelity plan reconciliation, 2026-07-12 · **Priority:** P3

Two open water questions, both investigate-first (implement OR defer with evidence):

1. **`fx wave` records** — 24,085 of 65,953 placements on the bridge map point at
   `test_effect.bmd` with no palette (engine-fx placeholders on `lmlt=1` void cells). The pipeline
   handles them nowhere; `GfxDynamicBackground` IS decoded (`tools/asset-pipeline/src/decoders/
   ini.ts`, schema `landscape/objects.ts` — set on exactly the 8 wave records) but is carried
   unconsumed, not even exposed in the app IR view. Inspect the owned records and decoded frames;
   draw them if their structure can be established, otherwise document and defer.
2. **Shore bands** — `lmms` (water-depth/shore rings 1..6, 7 = open sea; see
   `docs/formats/MAPDAT.md`) is
   NOT decoded anywhere. Compare shore bands against the corpus first: the baked `empa`/`empb`
   brightness may already carry the whole shore look, in which case there is nothing to do.

## Verify

- Side-by-side river/shore crops against locally captured reference images —
  **user's eyes**; a defer needs the comparison numbers in the closing commit.
