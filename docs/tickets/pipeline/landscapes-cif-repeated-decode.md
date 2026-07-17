# Cache the per-run `.cif` source reads (landscapes.cif decodes three times)

**Area:** pipeline · **Origin:** data+pipeline refactor-cleanup pass, 2026-07-17 · **Priority:** P3

`Data/engine2d/inis/landscapes/landscapes.cif` (683 KB) is read, decrypted, section-folded, and
extracted **three times** in one pipeline run, by three stages with independent lifetimes:

- `tools/asset-pipeline/src/stages/bmd/bindings.ts` — `resolveGraphicsBindings` (the `(bmd, palette)`
  atlas work list)
- `tools/asset-pipeline/src/stages/ir/index.ts` — `buildIr`'s `loadCifTable(..., extractLandscapeGfx, [])`
- `tools/asset-pipeline/src/stages/goods/icons.ts` — `buildGoodIcons` (the good→icon bindings)

Each does its own `readFile` → `decodeCifStringArray` → `cifLinesToSections` → `extract*`. The decrypt
+ section fold is the expensive half and is pure, so the repeat is waste, not correctness.

Deliberately **not** folded into the refactor-cleanup pass that found it: deduping needs a new
per-run source-cache seam threaded through three stages, which is a design change rather than a
cleanup. The cheap in-stage repeat (`goodtypes.ini` parsed twice inside `convertGoodsStage`) was
fixed in that pass; this one was left.

## Scope

- Introduce a per-run source cache (a small `SourceCache` beside `roots.ts`, keyed by resolved path)
  that memoizes `readFile` → decoded `RuleSection[]`, and thread it from `run.ts` into the three
  stages the way `indexOutTree`'s `OutTreeIndex` is now threaded (see `run.ts`, 2026-07-17).
- Keep it explicit — a passed-in cache, not a module-level singleton: the pipeline is a build tool but
  a hidden global cache makes stage tests order-dependent.
- Check whether other `.cif`/`.ini` sources are read more than once per run while you are there
  (`pattern.cif`, `trianglepatterntypes.cif`) and let the same seam cover them.

## Verify

- `npm test`, `npm run check`, `npm run build`.
- `npm run test:pipeline`, then regenerate and diff: `npm run pipeline -- --game "../Cultures 8th
  Wonder" --out content` must leave `content/ir.json` **byte-identical** to the pre-change baseline —
  a moved byte means a decode changed, not a cache hit.
- Worth recording the before/after wall-clock of a full run in the commit, since the payoff is
  build-time only.

## Source basis

Pure internal caching; no extraction semantics change. Decoder correctness stays pinned by the
synthetic round-trip fixtures.
