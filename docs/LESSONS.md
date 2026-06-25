# Lessons — the loop's hard-won memory

One-line, **commit-grounded** gotchas that a fresh-context iteration would otherwise re-learn. This
is the compounding half of the work loop: when a step surfaces a non-obvious, generalizable trap
(a determinism pitfall, a "green tests but broke at the real entry point" slip), it lands here so
the next iteration inherits it.

**Scope.** This file is *not* rules (those graduate to [`CLAUDE.md`](../CLAUDE.md) /
[`packages/sim/CLAUDE.md`](../packages/sim/CLAUDE.md)), *not* the plan
([`ROADMAP.md`](ROADMAP.md)), and *not* deferred reworks ([`TECH-DEBT.md`](TECH-DEBT.md)).

**Contract.**
- Format: `- [<sha>] <lesson> — <fix/why> (<area>)`. Ground every entry in the commit that taught it.
- Keep it lean: most steps add nothing. Add a line only when re-learning it would cost real time.
- Curation (a `/reflect` duty): promote a recurring / rule-worthy lesson into `CLAUDE.md` and prune
  it here; drop entries the code has made obsolete. This is the anti-bloat valve.

## Lessons

- [fec4ded] Integer atomic durations: `progress = ONE/duration` truncates, so an odd duration never
  reaches `ONE` and the atomic hangs forever — count an integer `elapsed` to the exact
  `elapsed >= duration`; keep `progress` only as a derived display value. (sim/atomic)
- [6a4d20a] Path completion removes `PathFollow` in pass 1, so a `Velocity`-bearing entity
  double-moves on its arrival tick unless pass 2 skips path-handled ids — record handled ids in a
  membership Set and skip them. (sim/movement)
- [ca10cf4] raw-TS strip-types can't resolve the sim's `.js` import specifiers, so the test fixture
  isn't in `dist/` — hands-on sim smoke runs go through a throwaway `vitest` spec on the real
  `Simulation.step()` schedule, not compiled `dist/`. (tooling)
- [bfe2491] A weapon `type` id isn't globally unique (105 weapons collapse to 19 typeIds — per-tribe
  re-use), so `indexById` silently drops records; key by `(tribeType, typeId)`. (data/extract)
- [9a497c9] `npm run build` (tsc) only compiles `src/**` — test files aren't in the project graph and
  vitest doesn't typecheck, so adding a required `SystemContext` field leaves stale test `ctx` literals
  type-broken yet green; grep `SystemContext = {` across `test/` when the context shape changes. (sim/tooling)
- [4ef956f] A roadmap "extract X from file Y" promise can name a field that file Y doesn't have —
  `landscapetypes.ini` has no per-type movement weight (only `maximumValency` + placement flags), so
  the long-carried "real per-type walk-cost field, pending extraction" was chasing a non-existent
  source. Before implementing a "pending extraction" step, grep the actual source file's key set
  first; correct the roadmap when the field isn't there rather than inventing a mapping. (data/roadmap)
- [79e02a7] Importing a `test/` file (e.g. a fixture) from production `src/` drags it into that
  package's `tsc --build` graph, which emits `.js`/`.d.ts` *in-place next to the .ts* — stray
  untracked artifacts `biome check` then lints and fails on. Keep dev/demo fixtures self-contained in
  `src/` (a tiny synthetic copy), don't reach across into another package's `test/`. (tooling/render)
- [94bae6d] A speculative/dead named-import added when extracting helpers into a new module slips
  past BOTH gates: biome's `recommended` set doesn't error on `noUnusedImports`, and `tsc`'s
  `noUnusedLocals` won't flag one *member* of a still-partly-used import group (`{ Building, Stockpile }`
  where only `Building` is used). Eyeball the new file's imports against its body after a module split —
  green build + green check don't prove every import is live. (sim/tooling)
- [76dfbf1] A long-open "binary format not located" risk can be a *wrong-file* assumption: the map
  tile grid was never in `map.cif` (only the logic-header `CStringArray`, 0 trailing bytes) — it's the
  sibling `map.dat`. Probe the whole asset *directory*, not just the named file; and check the
  OpenVikings oracle's IO/container helpers (`CIoHelper.cs` `SIoHelperChunk`) even though it "doesn't
  simulate" — it still pins the on-disk container layout. (pipeline/format)
- [fa70452] A `sim` mechanic with data-pinned *parameters* (atomic durations, job gates, stock caps)
  is NOT thereby `faithful` — its *behavior* (planner/loop shape) has no oracle (OpenVikings' tick is
  a stub). Classify those rows `approximated` with "calibration-by-observation pending"; reserve
  `faithful` for when both axes are pinned. Over-claiming faithful is the blind spot FIDELITY.md
  exists to catch. (docs/fidelity)
- [cfc2431] A binary format's "size" field can mean *different* things at adjacent offsets: the
  map.dat packed-layer header carries `innerSize` (the whole inner blob, +0x01 and again +0x11) AND
  a separate `unpackedLength` (+0x0D, the decoded byte count) — using the inner size as the stream
  length over-runs by exactly the header overhead. Drive the RLE loop by `unpackedLength` and let the
  stream end at the payload boundary; cross-check the decoded length is an exact multiple of `cells`.
  When porting a format the oracle doesn't cover, probe ≥3 real files of different sizes before trusting
  a field's meaning. (pipeline/format)
- [cfc2431] A "decode trusts the bytes" RLE/copy loop silently mis-decodes corrupt input: `Uint8Array.fill`
  clamps an over-long end (no throw), `subarray(i,i+b)` clamps a past-end read, and `out.set` then
  writes fewer bytes than the control advanced `o`/`i` by — so a truncated layer yields a zero-padded
  grid instead of the promised throw. Bounds-check both the source read (`i+b<=len`) and the dest write
  (`o+count<=unpacked`) explicitly per control byte if the decoder's contract says "throws on corrupt".
  (pipeline/format)
- [4b01c26] A decoded layer can carry MORE structure than the consumer wants: `map.dat` `lmlt` is the
  landscape-type grid but 4 B/cell (one typeId per triangle CORNER), while the nav cell-graph wants ONE
  typeId per cell. Confirm the lane by probing real maps (values 0..85 within the 87-type IR table,
  ~64% uniform cells), then pick a deterministic reduction (dominant corner, lowest-typeId tie-break)
  and classify it `approximated` in FIDELITY — the corner→cell rule has no behavioral oracle (OpenVikings
  decodes the container but doesn't simulate nav). Keep the reduction in the build tool, returning the
  plain `{width,height,typeIds}` shape, so it never imports `sim`. (pipeline/format)
- [5344d5d] A binary index lane and the IR table it keys into can use different bases: the `map.dat`
  `lmlt` layer is **0-based** (raw 0 = first type, "void") but `LandscapeType.typeId` mirrors the
  1-based `.ini` `type` field, so a grid built straight from the raw indices made the sim's
  `buildTerrainGraph` reject raw `0` as "absent from content". The decoder unit tests were green —
  the off-by-one only surfaced on the *real* `npm run pipeline` + loading an emitted grid through the
  real builder (the synthetic test grids happened to avoid typeId 0). When wiring a decoder's output
  into a consumer that *validates* against another table, run the consumer over the real output, not
  just the unit fixture; the earlier "values 0..85 within the 87-type table" note ([4b01c26]) was the
  0-based tell read as if 1-based. (pipeline/format)
- [7a95187] A `Uint16Array` view over a freshly-decoded byte buffer reads **host-endian**, not the
  file's byte order — and a pack→unpack round-trip test can't catch it (pack + unpack share the host's
  endianness, so the bug is invisible on the only realistic LE target). Compose multi-byte elements
  **explicitly LE** (`lo | hi<<8`), matching the file's existing `DataView(..., true)` reads, and pin
  it with a test that decodes a *hand-built LE stream* (not a round-trip) so an endianness regression
  fails even on a little-endian host. (pipeline/format)
- [690a547] vitest resolves a cross-package import (`@vinland/data`) through that package's BUILT
  `dist/` entry, not its `src/`, so a brand-new export is `… is not a function` in another package's
  test until you `npm run build` — green-looking source, runtime-missing symbol. After adding an export
  consumed by a *different* package's test, rebuild before `npm test` (or the failure looks like a typo,
  not a stale build). (tooling)
- [11cde56] The browser app can't read the gitignored repo-root `content/` directly (it's outside the
  vite root, and `fetch` needs an HTTP path). Bridge it with a **vite dev-server middleware**
  (`configureServer` → `server.middlewares.use('/maps', …)`) that serves the out-of-root files — but
  note vite **strips the mount prefix**, so `req.url` inside the handler is the path *after* `/maps`
  (e.g. `/oasis.json`, not `/maps/oasis.json`). Guard traversal at two layers (a `^[a-z0-9_-]+$` id
  regex on the fetch side + a resolved-path `startsWith(root + sep)` check in the middleware), and keep
  the consumer's load path **fallback-on-failure** so a checkout WITHOUT the gitignored content still
  runs. This is dev/shot-server only — a production `vite build` won't serve it. (app/render)
- [ac6a287] Component stores are module-level singletons SHARED by every `Simulation`/`World` instance
  (`defineComponent` makes one `Map`; `new World()` resets the id counter but NOT the stores). So a
  test that builds two sims in one process without clearing leaks the first run's entities into the
  second, and because `world.query` iterates **store insertion order**, the second sim's planner then
  acts on stale entities → non-deterministic. `hashState()` does NOT catch it: it hashes
  `canonicalEntities()` (sorted), so two runs can hash-equal mid-tick yet diverge once a query-order
  decision fires. Clear every component's store between runs (`for (v of Object.values(components)) if
  (v.store instanceof Map) v.store.clear()` — filter, the namespace also re-exports helpers), exactly
  as `golden-trace.test.ts` does in `beforeEach`. Surfaced only on a multi-ROW map (the 1-D 6×1 strip
  never exercised a query-order-dependent target choice). (sim/test)
- [12db5fa] An un-self-judgeable render step (pixels need a human) still has a self-verifiable HALF: the
  *data decision*. The atlas-sprite swap splits into "which atlas frame does this DrawItem draw"
  (`resolveSpriteFrame` — a pure lookup, fully unit-testable: bound→frame, tile/unbound/missing/0×0→null)
  and "bind that rect to a GPU texture + sample its pixels" (the human-judged half). Build + test the
  data half NOW, gate the pixel half on the human/asset, and keep the GPU input OPTIONAL (a `SpriteSheet?`
  defaulting to the placeholder path) so the reproducible `npm run shot` default is byte-unchanged.
  Generalises: when a step is "blocked on a human/asset", carve off the pure decision and land that. (render)
