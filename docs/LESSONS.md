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
- [dc1bb9b] A boolean "does ANY entity match?" query is order-independent, so it may iterate
  `world.query(...)` (insertion order) directly — it's a membership test like `Map.has`, which the
  determinism contract permits. Only a query whose RESULT depends on *which* match wins (a pick / a
  sum-with-order / a first-found mutation) needs `canonicalEntities()` + a sort. The `jobEnables`
  placement gate (`buildingEnabled`) returns true on the first enabling-job settler found and never
  cares which one — so a sorted scan would be dead cost. Ask "does the output change if matches are
  reordered?" before reaching for the canonical sort. (sim/determinism)
- [f6619a4] The mod's own `tribetypes - info.txt` doc can be wrong: it says `trainfor*`'s school
  expType is "always 77", but the real data also uses 57 (30/270 train lines), and it implies the
  `needfor*` expType is a `humanjobexperiencetypes` id (1..70) when need-ids actually reach 72/73/75.
  Extract the OBSERVED value, not the documented constant, and `grep` the real key set's value range
  before deciding what to cross-validate — an id that overshoots the resolvable table is the tell
  that a field is a wider/synthetic id space and must NOT be range-checked (false-positives). (pipeline/fidelity)
- [75b4e9c] Component stores are module-level singletons shared across every `Simulation` instance, so a
  multi-run hands-on smoke SCRIPT (not via the test harness, which clears them in `beforeEach`) leaks
  entities between runs — my "cross-tribe unlock" false alarm was run B's settler bleeding into run C.
  Clear the stores (or use one sim per process) between smoke runs; a direct helper call confirmed the
  gate itself was correct. (sim/verification)
- [c587b2b] When a *threshold-reader* consumes state a *writer* accrued, the fidelity win is that they
  key on the **same** id space with no translation layer: the `needfor*` `experienceTypes` reference the
  exact `humanjobexperiencetypes` track typeIds `grantWorkExperience` writes onto `Settler.experience`,
  so `experienceRequirementMet` joins the accrual half for free. But the reader must NOT cross-validate
  those ids — 23/26 real `need` expTypes resolve to a track, the other 3 (72/73/75) live in the wider
  id space the extractor already leaves unchecked ([f6619a4]) — so the read-side helper consumes the raw
  id and `.get()` simply returns 0 for an unmatched track (vacuously unmet), never throwing. Verify the
  join hands-on against the REAL IR (the keyspace overlap + the boundary gate), not just the fixture.
  (sim/progression)
- [8a0e4d6] An XP-`need` gate must be wired where the gated agent can ALSO satisfy it, or it deadlocks:
  reading `needforgood` as "the workplace OPERATOR's XP" looked obvious, but the operator (a carpenter)
  accrues no XP under the current sim (production grants none — `grantWorkExperience` fires only on
  harvest), so any non-zero threshold would lock that output forever. The faithful, non-deadlocking seam
  is the HARVEST planner (`nearestHarvestableFor`), where the gated settler IS the one who trains the
  good's track by doing the work the threshold guards. Before consuming a "you need XP in track T to do
  X" gate, check the sim actually grants track-T XP *to the agent X gates* — a gate whose input no agent
  can produce yet is a deadlock, not a faithful constraint; defer it to where the accrual loop closes.
  (sim/progression)
- [6264132] A new entity-assigning system stays deterministic AND self-balancing for free if it (a)
  iterates `canonicalEntities()` and takes the first match (a *pick*, so it must be canonical, unlike a
  boolean membership scan) and (b) re-derives the capacity count LIVE per candidate from world state
  rather than snapshotting it once: `jobSystem` assigns idle settlers in ascending-id order, and its
  `jobUnderstaffed` re-counts tribe-wide head-count each iteration, so assigning settler A bumps the
  count B sees — a 3-slot workplace fills with exactly 3, no shared mutable counter. A `query(Settler)`
  count is itself order-independent (addition commutes), so it needn't be canonical — only the *picking*
  loop does. The new system was provably inert in the golden (every golden/app settler spawns with an
  explicit non-null job, so no idle settler is ever assigned) — confirm a planner/assignment addition
  only fires on a state the goldens never construct before claiming the hash is untouched. (sim/determinism)
- [94e1b9c] A "walk TO target X" planner drive and the "stay put once ON X" pin must select the SAME
  set of entities, or a settler oscillates: `nearestUnstaffedWorkplaceFor` (the walk drive) first
  guarded only `Building`+`Position`+`recipe`, but `staffsWorkplaceHere` (the pin) queries
  `Building`+`Position`+`Stockpile` — so a producing-but-Stockpile-less workplace would be a walk
  target the pin then refuses to latch, looping walk→not-pinned→harvest→off-tile→walk forever. The
  bug was masked in practice (every `placeBuilding` adds a Stockpile unconditionally), so tests stayed
  green — the thrash only bites a hand-built fixture. When you add a drive that moves an entity to a
  predicate-matched target, make the target predicate IDENTICAL to the predicate that holds it there
  (copy the component query), don't approximate it. (sim/ai)
- [71f13ab] An explicit record component (`JobAssignment{workplace}`) needs a *lifecycle teardown*, not
  just creation: a settler bound to a building keeps a dangling binding to a DEAD entity when the
  building is destroyed — consumers only *defend* against the stale binding (treat-as-no-station), none
  *clear* it, so the worker is neither productive (workplace gone) nor re-employable (still looks
  bound). Put the teardown at the single destruction seam: `demolish` is the *only* `world.destroy`
  call site in the whole sim (no combat/decay path yet), so unbinding there covers every case today —
  and the cleanup belongs in the command handler, not in the generic `world.destroy` (which mustn't
  know about `JobAssignment`). When you add a component that *references another entity*, ask "what
  removes it when the referent dies?" the same iteration you add it. And: collect-then-mutate when a
  `query(A, B)` loop calls `world.remove(e, B)` — removing from the store the query may be iterating is
  a footgun; snapshot the matches first, then mutate. (sim/architecture)
- [3733380] Replacing a derived stand-in (tribe-wide head-count, on-tile presence) with an explicit
  record component (`JobAssignment{workplace}`) makes the new component the single source of truth — but
  the goldens spawn entities (the carpenter) *pre-employed onto their station* that never go through the
  assigning system, so they'd have NO binding and the binding-keyed pin would refuse to hold them →
  behavior change. Fix: have the assigning system *adopt* a pre-employed-but-unbound entity standing on
  a valid target (bind it to the building under its feet), so the record stays authoritative with the
  golden TRACE unchanged — only the hash moves (one new component on one entity), exactly the [20282ef]
  "new state, not a new action" split. And: a brand-new optional component must be added to EVERY test's
  store-clear list ([ac6a287]) — the leak shows up as a sibling test's *logic* failing (a stale binding
  inflates the per-building count), not as an obvious cross-contamination. (sim/architecture)
- [beb6629] Enabling a previously-skipped cross-ref check exposes the synthetic fixtures that exploited
  its absence: the `jobEnablesVehicle 5 7` fixture used an out-of-range marker id (7, no vehicle 7) that
  was harmless while the `vehicle` kind went unchecked, but the IR-integration test (which assembles a
  ContentSet from the *real-shaped* fixtures and asserts it validates) failed the instant the check
  landed — the unit-level order test was green, the assembled-set test was the tripwire. When you turn
  on a validation that was off, grep every fixture for that kind's edges and re-point them to in-range
  ids (the real ones — `jobEnablesVehicle` is `{1..5}`), AND run the real `npm run pipeline` to prove
  the live data resolves (the synthetic fixture proves the *check*; only the real run proves *fidelity*
  — 50 edges across 41 tribes, 0 dangling). The schema namespaces matter: the `vehicle` targetId keys
  into `vehicletypes.type` (the `logicvehicletype` space `{1..6}`), NOT the building space — so an empty
  buildings list can't mask a dangling vehicle edge; an old comment claiming `vehicle`→`BuildingType`
  was simply wrong. (data/extract)
- [f94a65b] Adding a new base `.ini` source to `resolveIniSources` breaks an *unrelated-looking* test:
  one case asserts the resolved source list with an exact `toEqual([...])` (the missing-source-warning
  test), so the new entry fails a sorted-list comparison far from the extractor you wrote. When you
  register a source, grep the pipeline test for `resolveIniSources(` + `toEqual`/`.sort()` and add the
  entry in sorted position. Also: a type table's `id` (a `name` slug) is NOT a unique key — `vehicletypes`
  genuinely ships two `oxcart` records, like `weapontypes`' duplicate `fist`; the cross-ref key is the
  numeric `typeId`, so don't `indexById` a freshly-extracted table without checking the source for dup
  names first. (pipeline/test)
- [08b33ed] `parseContentSet` does NOT default `goods`/`jobs`/`buildings` — they're required (only the
  *other* tables like `vehicles`/`tribes`/`landscape` default to `[]`). A new sim test that builds a
  minimal content set inline (instead of spreading `testContent()`) fails zod validation with `Required`
  on exactly those three, not on the field you were exercising. Either spread the fixture or include the
  three required arrays (even as one-element stubs). (sim/test)
- [5676e8c] An `Invariant` whose check needs CONTENT (here a building type's `homeSize`) doesn't fit the
  `(world) => string[]` signature — but don't widen that signature across every call site / `checkInvariants`.
  Make a **content-bound factory** `populationWithinHousing(content): Invariant` that closes over content
  and returns the plain `Invariant`; a scenario opts in via `invariants: [factory(content)]`, and it stays
  OUT of `CORE_INVARIANTS` (those must run content-free against any world). Same trick a new self-balancing
  system uses to stay inert in the goldens: the births fire only on `home`-kind content the golden/slice
  fixture never builds, so the golden hash + trace are untouched ([6264132]) — verify by grepping the
  fixture for the triggering shape before claiming the hash is stable. (sim/invariants)
- [37ba48a] A standalone smoke script that runs two `Simulation`s in one process sees them DIVERGE
  even on identical state — because `defineComponent` stores are module-level singletons that leak
  entities/ids across runs. The unit tests don't hit this (their `beforeEach` calls `c.store.clear()`).
  When hands-on-verifying determinism outside vitest, clear every component store between runs (the
  golden tests' pattern) before concluding a real non-determinism bug — `git stash` + re-run on `main`
  to check the divergence is in your change, not the harness, ruled it out here. (sim/determinism)
- [dc3ef54] A planner gate that keys on a `jobType`-ID predicate (`isNonWorkingAge`) silently snares an
  unrelated worker when a SYNTHETIC fixture's job id collides with a real data id: the golden slice's
  woodcutter is `jobType 1`, the same number as the real `baby_female` age class, so a new "skip
  non-working ages" check in the AI planner froze the whole golden trace to empty. The fixtures pick
  arbitrary small ids; the age-class ids 1–4 are a *real-data* meaning that doesn't hold in a fixture.
  Fix: gate on a COMPONENT whose presence carries the semantic (`Age` — only a born-young settler has
  one), not on the ambiguous id. When adding a sim rule keyed on a numeric content id that also has a
  reserved/structural meaning, prefer a component/flag the lifecycle maintains over the raw id — and run
  the goldens immediately, an emptied trace is the collision's tell. (sim/ai)
- [cef9629] A `Map`-valued **read view** (a HUD aggregate like `tribeStocks`) may safely iterate a
  `Map`/`Set` non-canonically — the determinism anti-pattern bans non-canonical iteration only for a
  *game decision*, and an aggregate whose VALUES are order-independent (a sum — addition commutes) is
  not one. The returned Map's iteration order is still insertion-order (store-traversal-dependent), so
  document that a display consumer must sort by key itself, and build each per-store sum via the
  canonical `stockpileEntries` to keep the idiom (the values are identical either way). The tell that
  it's a true read view: no system reads it back to branch on it — verify the change leaves the golden
  hash untouched (a read view adds no state). (sim/read-model)
- [4874a0f] When folding a nullable field (`Settler.jobType`) onto a sentinel key, use `?? sentinel`
  (nullish), never `|| sentinel`: a `JobType` id of `0` (`none`) is a VALID id, and `||` would silently
  fold every id-0 settler into the idle bucket. Pick the sentinel OUTSIDE the field's value space — a
  negative (`IDLE_JOB = -1`) for an id space that starts at 0 — so the "unassigned" bucket can never
  collide with a real id. (sim/read-model)
- [c00bf18] A `systems/*` export is NOT on `@vinland/sim`'s top level — `index.ts` re-exports it via
  `export * as systems from './systems/...'`, so the import is `import { systems } from '@vinland/sim';
  systems.goodsGraph`, not a named top-level import. The unit test passed (it imports straight from
  `../src/systems/index.js`), but the 3b hands-on `node -e` against `@vinland/sim` threw `does not
  provide an export named goodsGraph` — the exact "green test, broken at the real entry point" gap the
  hands-on step exists to catch. Mirror the real consumer's import surface in the smoke check. (sim/barrel)
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

- [0708fb4] A read view that returns a `Map` keyed by a "canonical identity" silently DROPS records
  when that identity isn't actually unique — the combat view keyed weapons by the documented
  `(tribeType, typeId)` cross-ref key ([bfe2491]), but the real ANIMAL weapons reuse even that pair
  (tribe 5 = `chicken`+`claw` at typeId 1; tribe 8 = doubled `bearfist`), so the Map collapsed 105
  weapons to 103 last-wins. The unit fixtures (distinct keys) stayed green; only the hands-on real-IR
  `table.size` count (105 vs 103) exposed it. When a read view must lose no records, return an ARRAY
  (one per source entry, source order) and carry the non-unique key as a FIELD, not the Map key — and
  always assert the hands-on output COUNT equals the source count, a keyed-collection size is the tell.
  (sim/read-model)
- [0cbe894] `.ini` key matching in the extractors is CASE-SENSITIVE (`p.key === key`) and the parser
  preserves the source casing verbatim — so an extractor must spell each key with the file's exact
  casing, which is often MIXED within one file (`armortypes.ini`: `type`/`goodtype` lowercase but
  `mainType`/`materialType`/`blockingValue` camelCase). `getInt(sec, 'maintype')` silently returns
  undefined where the file says `mainType`; the field just vanishes (no error), only caught by a
  hands-on pipeline run + asserting the value. `grep -oE '^[a-zA-Z]+' <file> | sort -u` the real keys
  first; match each verbatim (the established convention — see `atomicForHarvesting`). (asset-pipeline)
- [9b41021] A "shared helper leaf" module (the one the cyclic systems import to break import cycles)
  silently becomes a dumping ground: terminal read views (HUD/render projections no per-tick system
  feeds back into a decision) keep getting added there because the barrel re-exports them either way,
  and it doubled in size unnoticed. The leaf's actual membership rule is "imported by ≥1 module in
  SYSTEM_ORDER to break a cycle" — anything only consumed by render/tests is a projection and belongs
  in its own module (`systems/readviews.ts`). Splitting it is a pure import-path move (barrel surface
  unchanged, goldens unchanged); the tell is `grep "from './shared'"` showing the system files never
  import the read views. (sim/structure)
- [4b91238] An `AtomicEffect` keeps the executor a pure state-mutation by carrying the **already-resolved**
  value, not a lookup key: the `attack` effect carries the net `combatDamage` (weapon×armor) the same way
  `pickup`/`eat` carry a resolved `amount`, so `atomicSystem` does the hit with no content/weapon lookup
  of its own (the join happens once, at planning time). A new combatant pool is a **separate optional
  component** (`Health`, like `JobAssignment`/`Age`) so non-combatants/the golden slice carry none and the
  hash is untouched; HP is **whole-integer** (animaltypes.ini scale 200..20000), not a 0..ONE fixed bar,
  so `hitpoints <= 0` death is exact. Clamp damage twice — floor the result at 0 AND floor the incoming
  `damage` at 0 — so a malformed (negative) effect can't silently *heal* the target. (sim/combat)
- [e2f3a83] The dangling-reference hazard a `world.destroy` creates depends on which DIRECTION the
  cross-reference points: destroying a *settler* (the new combat death path, the SECOND destroy site
  after `demolish`) is clean because the settler HOLDS its refs (`JobAssignment` points
  settler→building) — they vanish with it; the [71f13ab] hazard was the REVERSE (a *building*
  destroyed under a worker that still points AT it), handled at the `demolish` seam. So when you add a
  destroy site, audit only the refs that point *to* the destroyed entity, not the ones it holds; here
  no component points building→settler, so the new path needs no teardown. And a system that
  `world.destroy`s while scanning a store must collect-then-destroy (gather matches into a list first,
  mutate after) — and sort that list canonically when its side effects are observed (the emitted
  `settlerDied` events render reads), even though events aren't in `hashState`. (sim/combat)
- [8addb28] A per-entity planner pass (combatSystem giving each idle combatant a target) can iterate
  the non-canonical `world.query(...)` (smallest-store insertion order) and STAY deterministic — but
  only because each decision is **order-invariant**: an attacker's target eligibility (`Health > 0`,
  different tribe, in range) never depends on whether another attacker already acted this pass, and the
  *target pick itself* uses canonical `canonicalEntities()` + an id tie-break. The rule isn't "always
  sort the driver"; it's "the OUTCOME must not depend on visit order" — adding a `CurrentAtomic` to A
  doesn't change whether A is a valid target for B, so the set of (attacker→target) decisions is the
  same regardless of order (same stance as aiSystem's `query(Settler, Position)`). The determinism test
  (two same-seed runs hash-equal) is what proves it, not the iteration choice. (sim/determinism)
- [8addb28] `sim.events` are cleared each tick, so a test that runs many `step()`s and then reads
  `sim.snapshot().events` only sees the LAST tick's events — a one-shot event (a kill's `settlerDied`)
  fired mid-loop is gone. Accumulate across the loop (`deaths += ...events.filter(...)` per step) to
  assert it, or the check silently degrades to a no-op (the `>= 0` trap). (sim/testing)
- [a4595ae] The "N data-defined tribes, never hardcode two" rule is satisfiable WITHOUT new code in the
  mechanics: the pipeline already extracts all 41 `[tribetype]`s and every sim rule resolves per-tribe
  off `settler.tribe → content.tribes.find(...)`, so the sim is tribe-agnostic by construction. The only
  thing missing was *classifying* which tribes are controllable — and the source distinguishes a
  civilization from an animal **by the data alone**: only a civilization carries `jobEnables` tech-graph
  edges (`jobEnables.length === 0` ⇔ animal, 0 mismatches against `jobRequirements` over the real IR).
  So the scaffolding is a pure read view filtering on that signature, not a hardcoded name/count. When a
  roadmap item says "data-defined X, never hardcode the count", first check whether the data already
  carries a *distinguishing field* — the classification is usually a read view, not a mechanic. And a
  read view that `.filter(...).sort(...)` is determinism-safe because `filter` allocates a fresh array,
  so the in-place `.sort()` never mutates the shared `content`. (sim/read-model)
- [fe7ac0e] A negative predicate over partial data has THREE truth states, not two: `isAnimalTribe`
  is NOT `!isPlayableTribe`. A tribe can be a known civilization (recorded, has tech graph), a known
  animal (recorded, empty tech graph), OR unknown (no record at all). `!isPlayableTribe` lumps the
  unknown case in with animals — wrong, because a no-record different-tribe combatant (a synthetic
  enemy) must stay a valid PvP enemy, not get silently reclassified as wildlife. When you split a set
  by a data signature, define each side as a POSITIVE membership test (`record exists && signature`),
  so the absent-record case falls through both rather than defaulting into one. (sim/data-classification)
- [838b1fa] Not every IR type table keys on `type` — `animaltypes.ini` keys on `tribetype` (an
  animal's identity IS its owning tribe; the source carries no `type`), and a couple of real records
  carry NO `tribetype` at all (disabled stubs). So this extractor DROPS-on-missing-key rather than
  `requireTypeId`-THROWS: the throw stance is right when the key's absence is malformed, but wrong when
  the key is legitimately absent in shipped data. Check the real file's key field + look for records
  missing it before assuming the `requireTypeId(...,'type')` template; the cross-ref then validates the
  chosen key (here `tribeType` → the tribe table). (pipeline/extractor)
- [4566b16] A "single source of truth" relation must gate BOTH sides itself, not lean on its one caller.
  `mayAttack(attacker,target)` first encoded only the target rules and let the combat loop skip a passive
  animal attacker — so `mayAttack(passiveAnimal, civ)` wrongly returned true; correct in-system (the loop
  guards), but a latent trap the moment a second caller uses the relation directly. Fix: fold the attacker
  gate into the relation; the loop's matching skip becomes a fast-path, not the authority. A relation
  documented as authoritative must be self-contained. (sim/combat)
- [8579a56] The committed local `content/ir.json` can be STALE relative to the extractors: it had
  `animals: 0` (predating the animaltypes extractor), so a hands-on check that read it would have
  "passed" against zero real records — a false green. For a read view over extracted data, exercise
  it against a FRESHLY re-run pipeline (`npm run pipeline … --out <scratch>`), not the checked-in IR,
  or the 3b smoke check verifies nothing. (pipeline/hands-on)
- [9ce6413] A deterministic entity-scatter that CLAMPS each member's offset to a max radius silently
  re-uses tiles once the rings past that radius repeat (clamp(ring, range) collapses ring 3+ onto the
  range-2 ring) — two entities stack. It's only safe here because the sim has **no position-uniqueness
  invariant** (entities share tiles freely) and real `animaltypes` `maximumgroupsize` (3..6) stays under
  the 9-tile first-ring bound; assert the no-stacking property only for the sizes you actually spawn,
  and document the collision bound rather than implying a packing guarantee. (sim/spawn)
