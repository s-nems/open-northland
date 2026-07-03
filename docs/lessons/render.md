# Lessons — render & app (Pixi, scenes, bindings, browser glue)

Part of the loop's hard-won memory. The contract (one entry per trap, commit-grounded,
extend-don't-duplicate, graduate a thrice-hit trap to a `CLAUDE.md`) lives in
[`../LESSONS.md`](../LESSONS.md) — read it before adding here.

- [11cde56] The browser app can't read the gitignored repo-root `content/` directly (it's outside the
  vite root, and `fetch` needs an HTTP path). Bridge it with a **vite dev-server middleware**
  (`configureServer` → `server.middlewares.use('/maps', …)`) that serves the out-of-root files — but
  note vite **strips the mount prefix**, so `req.url` inside the handler is the path *after* `/maps`
  (e.g. `/oasis.json`, not `/maps/oasis.json`). Guard traversal at two layers (a `^[a-z0-9_-]+$` id
  regex on the fetch side + a resolved-path `startsWith(root + sep)` check in the middleware), and keep
  the consumer's load path **fallback-on-failure** so a checkout WITHOUT the gitignored content still
  runs. This is dev/shot-server only — a production `vite build` won't serve it. (app/render)
- [12db5fa] An un-self-judgeable render step (pixels need a human) still has a self-verifiable HALF: the
  *data decision*. The atlas-sprite swap splits into "which atlas frame does this DrawItem draw"
  (`resolveSpriteFrame` — a pure lookup, fully unit-testable: bound→frame, tile/unbound/missing/0×0→null)
  and "bind that rect to a GPU texture + sample its pixels" (the human-judged half). Build + test the
  data half NOW, gate the pixel half on the human/asset, and keep the GPU input OPTIONAL (a `SpriteSheet?`
  defaulting to the placeholder path) so the reproducible `npm run shot` default is byte-unchanged.
  Generalises: when a step is "blocked on a human/asset", carve off the pure decision and land that. (render)
- [51eb0d4] When a render binding can be EITHER a scalar or a per-state table (`number |
  SettlerStateBinding`), drive the atlas tests through the public `resolveSpriteFrame(item, …)` seam, not
  by indexing `bindings[kind]` as a bob id directly — the moment `settler` became a table, every test
  that did `atlas.frames.get(SYNTHETIC_BINDINGS[k])` broke, and resolving via the public lookup also
  caught a real frame-overlap (new settler frames collided with the building rect) + a sheet-bounds
  overrun the bounds assertion then flagged (had to grow `SYNTHETIC_ATLAS_HEIGHT`). A no-overlap test
  that enumerates *resolved* frames (all states) is the one that catches a layout collision; one keyed
  off raw ids silently skips the new frames. (render/test)
- [400e8a9] To EXERCISE (not just unit-test) a render branch that's blocked on a copyrighted asset, a
  FREE SYNTHETIC stand-in unblocks it: a tiny hand-authored atlas (flat-colour marker frames drawn into
  a `CanvasSource`) binds through the exact same `SpriteSheet` shape a real bob atlas will, so the
  textured branch runs + is human-eyeballable today and the real art drops in later with no renderer
  change. Gate it behind an OPT-IN flag (`?atlas`, `--atlas`) so the byte-reproducible default
  (`npm run shot`) is untouched — and forward the flag through the harness script too (`shot.mjs`), or
  the "real entry point" can't reach the new path even though the app code supports it. (render/app)
- [faa7885] The render-side HUD must RE-DERIVE its aggregates from the `WorldSnapshot`, NOT call the
  sim's `tribeStocks`/`tribePopulationByJob` read views — those take a live `World`, and `render`
  reading the live stores breaks the pure-consumer rule (the whole point of the snapshot seam). The
  re-derivation is trivial because a count/sum is order-independent (so it matches the sim view by
  construction), but two shape gotchas bite: (a) the snapshot's `clonePlain` turns a component `Map`
  (`Stockpile.amounts`) into a **sorted `[k,v]` array**, so read it as an array, never `.get()`; (b)
  the intermediate aggregation `Map`s are built in entity order, so **explicitly sort the output** by
  id — don't lean on the snapshot's per-entity Map ordering for the cross-entity tallies. A render
  read view mirrors a sim read view's VALUES but lives in `render` and sources the snapshot. (render/hud)
- [d931e4e] An OVERLAY draw (`renderHud`) that `addChild`s a fresh `Container` each frame doesn't leak
  across frames ONLY because the scene draw it follows opens with `app.stage.removeChildren()` — that
  clear wipes the *whole* stage incl. last frame's overlay, so the overlay self-cleans iff it's always
  drawn AFTER `renderScene` (document the ordering). Keep the overlay a separate, independently-callable
  fn that ends in its own `app.render()` (the twin-of-`renderScene` symmetry) and accept the second
  `render()` per frame as the cost of composability — don't fold it into `renderScene`. Match the
  sibling's GPU-resource lifecycle too: `renderScene` never `.destroy()`s its per-frame `Graphics`/
  `Texture`, so a new overlay shouldn't either — destroying-on-remove is a separate render-perf pass over
  BOTH, not a HUD-only divergence. (render/pixi)
- [617e446] A data-driven map that WHOLESALE-replaces a known-good fallback constant degrades *worse*
  than having no data: on a partial/corrupt source the keys it omits drop to the generic `default`
  instead of the constant's value. Overlay the data ONTO the constant (`{ ...CONST, ...data }`) so
  degradation is per-key, not all-or-nothing — and it folds the empty/absent cases away for free
  (`{...undefined}`/`{...{}}` spread to nothing). (render/data-binding)
- [37c7984] A layer-qualified building binding (`{layer, bob}`) for a named atlas family that is NOT
  loaded does **not** degrade to placeholder — `atlasLayers` falls a missing-family ref THROUGH to the
  default `kindLayers.building` layer and blits `bob` there, drawing the WRONG sprite (the families have
  disjoint frame-id spaces). So the reducer must emit a `{layer}` ref ONLY for a family the loader
  actually loaded. Make the family list the SINGLE source of truth (`BUILDING_FAMILIES` both drives
  `loadLayer` and gates which rows `buildingBobRefsByType` may layer-qualify) so the loaded set and the
  emitted set can't drift; a row in an unloaded family is dropped (→ the constant/default backs it).
  (render/data-binding)
- [4b74aeb] Canvas pointer math must convert client (CSS-px) coords into the **backing-store** space the
  renderer works in: `#game` is CSS-stretched to the viewport while the Pixi backing store is fixed
  960×540, so feeding raw `clientX`/drag-deltas to a camera that lives in backing px makes drag pan
  faster than the cursor and breaks the anchored-zoom invariant (the world point under the cursor drifts).
  Scale by `canvas.width/rect.width` (subtract `rect.left` first for absolute cursor coords). The reducer
  unit test passed because it fed coords already in camera space — the DOM→camera conversion was the
  untested gap, surfaced only by zooming in the live page. (app/render)
- [3e3537d] The render read of a unit's movement state must treat "in transit" as more than a live
  `PathFollow`. A combat chaser re-issues its route toward a moving enemy every few ticks, dropping the
  `PathFollow` for ONE tick while it still holds a `MoveGoal` / a freshly-queued `PathRequest` — reading
  that gap as `idle` snapped the walk animation to the standing pose (and facing to the default) once per
  tile, a visible march "stutter" even though the SIM position advanced smoothly every tick (a headless
  per-tick position trace proved the sim was fine — the artifact was purely the render read). Count a
  `MoveGoal` or a non-failed `PathRequest` as `moving`; keep a FAILED `PathRequest` `idle` so a stuck unit
  doesn't moonwalk; and make facing sticky in the pool across the gap. The bug hid because the state
  read's unit test only covered `PathFollow`/`CurrentAtomic`, not the between-paths transient. (render)
- [harvest-swing-length] An action animation (chop) plays on the atomic's own `elapsed` clock, so the
  swing plays fully ONLY if the sim atomic's `duration` covers one whole render cycle. The render draws
  frames at ticks `1..duration-1` (clock = `elapsed-1`; the completion tick removes the atomic before it
  draws), so a full `CHOP_STRIDE`-frame swing needs `duration = CHOP_STRIDE + 1` ticks — a SHORTER value
  replays only the leading (windup) frames and restarts every atomic, the visible "axe never strikes"
  glitch. This length lived as a per-scene literal in each scene's `atomicAnimations` and drifted (the
  gathering scene had 6 vs the swing's 16); fix by driving EVERY scene off the one `HARVEST_SWING_LENGTH`
  export (settler-gfx), derived from the render `CHOP_STRIDE`, so a scene can't mistune it. A per-scene
  magic number that must equal a value owned elsewhere is a bug waiting to drift — export the source. (app/render)
