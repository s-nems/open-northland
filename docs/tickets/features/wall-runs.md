# Join palisades/walls into continuous runs (investigate-first)

**Area:** app (possibly pipeline) · **Origin:** map-visual-fidelity plan reconciliation, 2026-07-12 · **Priority:** P3

`loadMapObjects` (`packages/app/src/content/objects.ts`) draws one sprite per placement with no
neighbour awareness; the bridge map places only `wall_03` (a 15×71 single post), so palisade runs
read as isolated poles.

**Known facts / open hypothesis:** `wall_03/04/05` = "Mur h"/"Mur V" share typeId 22. Wall cells
were observed carrying `lmlp` 4/5 — hypothesized as an orientation lane, but `lmlp` is decoded
NOWHERE in the pipeline (the old plan's "decoded but unconsumed" claim was wrong). Two legit
outcomes: implement, or defer with evidence.

## Scope

1. Investigate: dump wall placements' neighbour adjacency; decode `lmlp` for wall cells
   (`tools/asset-pipeline/src/decoders/mapdat.ts`) and test whether 4/5 splits by run direction;
   template-match `wall_03/04/05` against the corpus (kit in `docs/SOURCES.md`).
2. Implement a per-placement variant/frame pick in `objects.ts` — still one sprite per placement,
   deterministic, load-time. Record the pinned-vs-approximated split.
3. Split into two tickets if `lmlp` must become a pipeline-emitted lane.

## Verify

- Unit test the direction rule on synthetic placement sets.
- Side-by-side of the north-base palisade vs the mosty-5 reference — **user's eyes**.
