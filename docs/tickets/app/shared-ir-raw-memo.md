# Share one raw ir.json memo between loadIr and loadRealContent (avoid double-parse)

**Area:** app (content) · **Origin:** code-review of real-content-loader, 2026-07-14 · **Priority:** P3

`loadIr` (`packages/app/src/content/ir.ts`) owns the one memoized `/ir.json` fetch every graphics
domain shares — the multi-MB document is fetched + `JSON.parse`d once per page. `loadRealContent`
(`packages/app/src/content/real-content.ts`) opens a second, independent `/ir.json` fetch + parse to
produce the validated sim `ContentSet`. Both now run on the same page: `entries/map.ts` calls
`loadRuntimeRealContent` and then `loadIr`, and `entries/scene.ts` does the same — so the multi-MB IR
is JSON-parsed twice with two heap copies. The browser HTTP cache dedups the network fetch, not the
parse.

The two loaders need different *outputs* (the unvalidated `ContentIr` render view vs the zod-validated
`ContentSet`), but both start from the same raw JSON, so they can share one raw-JSON memo and each
shape it.

## Scope

- Extract a shared memoized raw-`/ir.json` load; have `loadIr` and `loadRealContent` both derive from
  it (each keeps its own output type + validation). Preserve `loadRealContent`'s injectable-`fetch`
  test seam and both loaders' degrade-to-null-on-absent behavior.

## Verify

- `npm test` + `npm run check` + `npm run build`; assert one `/ir.json` fetch+parse when both loaders
  run on one page.

## Source basis

Pure perf/dedup refactor; no behavior change intended.
