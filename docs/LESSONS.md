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
- [a9dd864] An `.ini` line is one of two shapes — a *repeated single-value* key (`allowatomic N`,
  many lines) or a *single multi-value* line (`productionInputGoods 5 6 6`, one line, all tokens on it).
  The existing `getIntList` helper only reads `values[0]` of each matching property, so it silently
  drops every token but the first of a multi-value line (it was built for the repeated-key shape). For a
  multi-value line use a helper that reads ALL of `findProp(...).values`; eyeball the real source's
  grammar for the key before reusing a list helper, the names don't tell you which shape it is. The mod
  often has no readable twin for a base table (`goodtypes` ships only as base `Data/logic/*.ini`), so
  golden-rule-#4 "prefer the mod `.ini`" can fall through to the base `.ini` — that's still readable, not
  the encrypted `.cif`. (pipeline/format)
- [309e600] A data param that *varies along a dimension absent at the extraction layer* (production
  cycle `ticks` is per-tribe — viking coiner=200, frank coiner=60 — but the building-type table has no
  tribe) can still be pinned to a REAL source instead of a magic constant: pick a deterministic
  reference along that dimension (lowest-`typeId` tribe), resolve the actual value (worker `jobType` +
  good's `atomicForProduction` → that tribe's `setatomic` → `atomicanimations.length`), and record the
  collapsed dimension as a Deviation in FIDELITY.md. Strictly more faithful than a placeholder — and the
  per-dimension table stays a clean deferred refinement. Watch the produce-atomic join's fallbacks: a
  raw-good producer has no `atomicForProduction`, so guard each link and fall back per-building. (pipeline/fidelity)
- [20282ef] A worker-presence production gate moves the integration golden's state HASH but not its
  atomic TRACE: staffing the sawmill adds a new operator entity (the canonical full-state hash hashes
  every component on every entity, so a new entity shifts it), yet the behavioral atomic-trace +
  produced count are unchanged. That split is the right read of an intentional golden move — re-baseline
  the hash, but if the trace also moves, a real *behavior* changed and you must look harder. Keep the
  worker pinned without the full JobSystem by a narrow "a settler standing on a workplace it staffs is
  left put" planner rule (gated on the building having a RECIPE, so a store/HQ listing the same job
  doesn't freeze a harvester). (sim/goldens)
- [18243f3] A source's category flags can be INDEPENDENT booleans, not a mutually-exclusive enum: a
  `[goodtype]` sets `isProducedOnMapFlag`/`isProducedInHouseFlag`/`isInputGoodFlag` separately and the
  real data sets several at once (`leather` carries all three — gathered AND house-produced AND an
  input). Modelling such "raw vs produced vs input" layering as one enum would have to invent a
  precedence the source doesn't have; extract each flag as its own boolean and let a good occupy
  several layers. Confirm by grepping a record you expect to be "obviously one category" — the
  exception is the tell. (pipeline/format)
- [2cf9301] A behavior with no sim-oracle can still pin its *atomic id* from the original `tribetypes`
  `setatomic <job> <atomicId> "<animation>"` table even when nothing else about the behavior is
  pinned: grepping the real `tribetypes.ini` for the activity name (`eat_slot_food` → `setatomic 5 10`)
  reveals the canonical atomic id (eat=10, candy=11) for free, splitting a planner mechanic into a
  faithful id + animation-`length` join and an approximated trigger/target. Before inventing a magic
  atomic-id constant, grep `tribetypes` for the action name — the slot id is sitting right there. And
  put the eat-drive ABOVE the workplace-staffing pin in the planner, or a starving operator never
  leaves to feed. (sim/fidelity)
- [e13314d] A **target-bound** need (the settler must reach a SITE to satisfy it, unlike eat-at-a-store
  / sleep-in-place) needs a need→satisfier→**building** lookup — and the satisfier building is often
  identified by a *structural signature*, not a readable flag: the original "work temple" (logictype 37,
  logicmaintype 3) carries no `logicworker`/`logicstock`/`logicproduction`, so it surfaces as a
  `workplace` kind with no recipe/workers/stock — exactly the "infer the binding that lives below the
  readable data" pattern `isFood` uses (the `food_` id prefix). Don't invent a content flag the data
  lacks; recognise the building by what it conspicuously *omits*. And the new walk-to-target reuses the
  existing MoveGoal→PathRequest→PathFollow chain for free — the drive only sets the goal. (sim/fidelity)
- [3826bab] The temple structural-signature trick does NOT generalize to every target-bound need — it
  worked for `pray` only because the temple is (nearly) the unique no-recipe/no-worker/no-stock house.
  `enjoy` (id 17) has no readable building satisfier: the only houses with that signature are `work
  temple` (lt 37) and `work murek` (a decorative wall, lt 55), so structural inference can't name a
  leisure site. Verify the satisfier is actually distinguishable in `houses.ini` BEFORE planning a
  drive — don't assume the previous need's approach ports. When it can't be pinned, ship the rise+reset
  half (both pinned to data) and defer the drive in FIDELITY rather than inventing a satisfier. (sim/fidelity)

- [8302ea7] A named atomic isn't necessarily a new NEED — it may be a second SATISFIER of an existing
  one. `make_love` (id 78) reads like a distinct social need, but its animation restores the **same
  channel 3** as `enjoy` (`event <at> 3 +800` vs enjoy's `+100`), i.e. the leisure/`enjoyment` bar — so
  it resets the existing field, no new component. Before adding a need field for a satisfier atomic,
  read the animation's `event <at> <channel> <delta>` tuples and check which channel it restores; the
  bar count is set by the distinct channels, not by the atomic count. (sim/fidelity)
- [97d6755] A roadmap item's logic doesn't always belong in the system named after it. The
  ProgressionSystem's XP-accrual is **event-shaped** (it fires at the instant a work atomic completes),
  but sim events are render-only (must not be read back in sim logic), so a poll-driven `System` can't
  see the completion. The grant lives in the AtomicSystem's effect-apply (where the completion is
  known), exactly like the hunger/fatigue resets; the `progressionSystem` stub stays for the *gating*
  half. Before graduating a stub system, ask whether its logic is poll-shaped or event-shaped — the
  latter belongs at the event source. (sim/architecture)
- [2b407e0] When unifying several repeated `.ini` keys into one list IR, don't iterate key-by-key
  (`findProps(a)` then `findProps(b)`…) — that regroups the records by key and silently loses the
  source's interleaving. The `tribetypes` `jobEnables{Good,House,Job,Vehicle}` lines interleave the
  four kinds within a job's block; a single `sec.props` pass keyed on a kind-lookup keeps verbatim
  file order. Check the real source's ordering before choosing grouped vs single-pass extraction. (pipeline/fidelity)
