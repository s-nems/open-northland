# Switch the interactive entries onto real content

**Area:** app (entries + content) · **Origin:** real-content chain · **Priority:** P1

The economy is migrated (sandbox ids re-keyed to real ir.json), the gathering data is completed and its
gaps surfaced (`content/real-content.ts` `mergeRealContent`), and the terrain blocker is resolved: the
sim's nav-terrain classes now sit in a reserved band (`catalog/terrain.ts` `TERRAIN_CLASS_BASE`) and
`mergeRealContent` injects them into real content, so `new Simulation({ content: mergedRealContent, … })`
builds its terrain graph on a collision-resolved grid without the "typeId absent" crash (see
`test/real-content-merge.test.ts`). What remains is wiring the interactive entries to actually load and
run that merged real content.

## Scope — wire the entries (keep `?shot` + every headless test on the clean-room sandbox)

- **`loadRuntimeRealContent()`** in `content/real-content.ts` — fetch `loadRealContent()`, run
  `mergeRealContent`, return the sim-ready `ContentSet` plus the gap lists. Returns `null` on a bare
  checkout (no ir.json) so the entries fall back to sandbox content.
- **`logRealContentGaps(merge)`** — one console line for the `unbalancedGoods` (the 5 uncalibrated
  gathered goods) + `uncatalogedBuildings` (the ~14 wonders/vehicles), so the gap is visible in-browser.
- **`goodNames` param on `mergeRealContent`** — localize real machine-id good names (the real set ships
  raw ids where the sandbox carried English `name`s); thread the app's `?lang=` good-name map through so
  the HUD/Magazyn read localized names.
- **`content?` override** on `createSceneSim` / `runSlice` / `runBareMap` / `runAuthoredSlice` — default
  stays sandbox content; the interactive entries pass the merged real content.
- **`entries/scene.ts` + `entries/map.ts`** — load and pass the merged real content, and drive the
  `?map=` sprite sheet off the real goods. `?map=<real decoded map>` is real content's natural home (real
  terrain); `?scene=` runs on the synthetic grid over real content.

## Verify

- Headless: sim-package goldens byte-identical; `?shot` and every test stay clean-room sandbox (real
  content is browser-only, never in tests). When wired, extend `test/real-content-merge.test.ts` to
  assert the *real* gathering-block shape (harvest/pickup/store atomics preserved) — deferred until a
  real-shaped fixture exists; the string ids are confirmed (`mud`, not `clay`).
- Browser `?map=<real map>`: real buildings place, Magazyn shows a real store's larder with icons, the
  economy runs, no terrain crash — **user's eyes** (screenshot first yourself). The gap log prints.

This is where the retired `real-content-goldens` ticket's app-test id moves land: the re-key already
updated the app tests it broke, so the only further golden moves are whatever the real-content browser
path changes — none until this ticket lands.
