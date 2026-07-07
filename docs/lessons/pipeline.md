# Lessons — asset pipeline (decoders, extractors, IR/data)

Part of the loop's hard-won memory. The contract (one entry per trap, commit-grounded,
extend-don't-duplicate, graduate a thrice-hit trap to an `AGENTS.md`) lives in
[`../LESSONS.md`](../LESSONS.md) — read it before adding here.

- [bfe2491] A weapon `type` id isn't globally unique (105 weapons collapse to 19 typeIds — per-tribe
  re-use), so `indexById` silently drops records; key by `(tribeType, typeId)`. (data/extract)
- [76dfbf1] A long-open "binary format not located" risk can be a *wrong-file* assumption: the map
  tile grid was never in `map.cif` (only the logic-header `CStringArray`, 0 trailing bytes) — it's the
  sibling `map.dat`. Probe the whole asset *directory*, not just the named file; and check the
  OpenVikings oracle's IO/container helpers (`CIoHelper.cs` `SIoHelperChunk`) even though it "doesn't
  simulate" — it still pins the on-disk container layout. (pipeline/format)
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
- [18243f3] A source's category flags can be INDEPENDENT booleans, not a mutually-exclusive enum: a
  `[goodtype]` sets `isProducedOnMapFlag`/`isProducedInHouseFlag`/`isInputGoodFlag` separately and the
  real data sets several at once (`leather` carries all three — gathered AND house-produced AND an
  input). Modelling such "raw vs produced vs input" layering as one enum would have to invent a
  precedence the source doesn't have; extract each flag as its own boolean and let a good occupy
  several layers. Confirm by grepping a record you expect to be "obviously one category" — the
  exception is the tell. (pipeline/format)
- [2b407e0] When unifying several repeated `.ini` keys into one list IR, don't iterate key-by-key
  (`findProps(a)` then `findProps(b)`…) — that regroups the records by key and silently loses the
  source's interleaving. The `tribetypes` `jobEnables{Good,House,Job,Vehicle}` lines interleave the
  four kinds within a job's block; a single `sec.props` pass keyed on a kind-lookup keeps verbatim
  file order. Check the real source's ordering before choosing grouped vs single-pass extraction. (pipeline/fidelity)
- [f6619a4] The mod's own `tribetypes - info.txt` doc can be wrong: it says `trainfor*`'s school
  expType is "always 77", but the real data also uses 57 (30/270 train lines), and it implies the
  `needfor*` expType is a `humanjobexperiencetypes` id (1..70) when need-ids actually reach 72/73/75.
  Extract the OBSERVED value, not the documented constant, and `grep` the real key set's value range
  before deciding what to cross-validate — an id that overshoots the resolvable table is the tell
  that a field is a wider/synthetic id space and must NOT be range-checked (false-positives). (pipeline/fidelity)
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
- [0cbe894] **Grep the REAL source — and the real extractor, and the real `ir.json` — before extracting;
  never the schema, the fixture, or a roadmap promise.** (a) `.ini` key matching is CASE-SENSITIVE and
  the parser preserves verbatim casing, often MIXED within one file (`armortypes.ini` `type` lowercase
  but `mainType` camelCase; `weapons.ini` camelCase `mainType` beside lowercase `munitiontype`,
  [dfa7d02]) — `getInt(sec,'maintype')` silently returns undefined where the file says `mainType`, the
  field just vanishes; `grep -oE '^[a-zA-Z]+' <file> | sort -u` the keys and match each verbatim. (b) A
  roadmap "extract X from Y" can name a field Y doesn't HAVE ([4ef956f]: `landscapetypes.ini` has no
  walk-cost) or an overlay-MERGE that doesn't exist ([796fcb2]: the mod ships no logic-table twins —
  `find` the mod tree first); fix the roadmap, don't invent a mapping. (c) A `Logic*` datum can live in
  the GRAPHICS twin, not the logic file ([3215de3]: `houses.ini` `[GfxHouse] LogicConstructionGoods`) —
  grep the other readable file for the prefix before calling it "oracle-blocked". (d) Schema-present +
  validated ≠ EXTRACTED — a `.default(...)` the pipeline never populates ([4b01d2a]:
  `LandscapeType.walkable`) is a bogus fidelity basis; grep the EXTRACTOR, confirm on the real
  `content/ir.json` where defaults and source diverge (the fixture hides it). (asset-pipeline)
- [838b1fa] Not every IR type table keys on `type` — `animaltypes.ini` keys on `tribetype` (an
  animal's identity IS its owning tribe; the source carries no `type`), and a couple of real records
  carry NO `tribetype` at all (disabled stubs). So this extractor DROPS-on-missing-key rather than
  `requireTypeId`-THROWS: the throw stance is right when the key's absence is malformed, but wrong when
  the key is legitimately absent in shipped data. Check the real file's key field + look for records
  missing it before assuming the `requireTypeId(...,'type')` template; the cross-ref then validates the
  chosen key (here `tribeType` → the tribe table). (pipeline/extractor)
- [8579a56] The committed local `content/ir.json` can be STALE relative to the extractors: it had
  `animals: 0` (predating the animaltypes extractor), so a hands-on check that read it would have
  "passed" against zero real records — a false green. For a read view over extracted data, exercise
  it against a FRESHLY re-run pipeline (`npm run pipeline … --out <scratch>`), not the checked-in IR,
  or the 3b smoke check verifies nothing. (pipeline/hands-on)
- [6badd48] A `nonnegative`-`TypeId` schema field does NOT protect a cross-ref from a `0` SENTINEL —
  many `.ini` foreign keys use `0` to mean "none" (weapon `goodtype 0` = a natural fist/claw with no
  craftable good, the armor-class-0 / `damage["0"]` = "unarmored" pattern one axis over), but `TypeId`
  is `z.number().int().nonnegative()` so `parse(0)` SUCCEEDS — the bad id then sails into the IR and the
  `validateCrossReferences` loop false-flags every sentinel record as "unknown goodType 0" (good ids
  start at 1, so 0 never resolves). Drop the sentinel to `undefined` AT EXTRACT (`raw === 0 ? undefined
  : raw`), so the `field !== undefined` cross-ref skip treats "none" as absent — don't lean on the
  schema to reject it (a `nonnegative` brand won't) and don't widen the cross-ref to special-case 0.
  Confirm the split on real data (105 weapons → 70 resolving / 35 dropped, 0 dangling) so the sentinel
  count is provably the natural-weapon set, not a silently-mangled good ref. (pipeline/data)
- [7c3577d] **Count the RIGHT thing — derive N from the hands-on output, never a value range or a string
  total.** (a) A `.cif` table's "N records" in SOURCES.md is the decoder's string-pool LINE count, not the
  record count: `trianglepatterntypes.cif` "(82)" is 10 headers + 72 property lines = 82 strings but only
  **10** records (housetypes 798 / weapontypes 2995 likewise) — decode and count level-1 sections. (b) A
  repeated-`.ini`-key "count" is the LINE count, not the highest enumerated id ([d7eb755]: `logicgood` is
  49 lines, not 54 read off max good id 55) — derive it from `cargoGoods.length` / an `awk` line count. (pipeline)
- [99c7a13] One `[GfxHouse]` bracket can pack MANY records: the mod groups 4–24 houses under a single
  `[GfxHouse]` header, each sub-house delimited only by a fresh `EditName` (no new `[...]`), so
  `parseIniSections` (opens a section only on a bracket) lumps them into ONE `RuleSection`. An extractor
  that assumes one-record-per-section reads the FIRST sub-house's `GfxBobLibs`/`GfxPalette` but last-wins
  `LogicType`/`GfxBobId` across the whole block → drops/mis-joins the lumped families (here 63 of 234
  saracen/egypt types). Synthetic one-record-per-bracket fixtures stay green, and a hands-on check on ONE
  tribe (its own brackets) looks fine — the gap only shows if you verify breadth against the real file's
  per-section record count. Fix: split a section into sub-records on `EditName` before extracting.
  (`extractConstructionCosts`/`extractBuildingGraphics` have the same latent bug.) (pipeline)
- [a7095e7] An "oracle-blocked algorithm" can be a non-problem because the SAVE stores the
  algorithm's OUTPUT: the per-triangle ground-pattern choice everyone assumed needed reversing sits
  verbatim in `map.dat`'s `empa`/`empb` lanes (the editor runs the placement algorithm at author
  time). Before scheduling an algorithm-reversing research task, probe the save format for the
  algorithm's *result* — engines bake expensive decisions into their artifacts. The same probe also
  found the maps reference shared tables **by NAME dictionaries** (`eapd`/`eald` mirror the
  `pattern.cif`/`landscapes.cif` EditName lists exactly), which is the version-robust join key the
  emitted JSON should carry too. (pipeline/format)
- [a7095e7] A "4 B/cell" lane may really be a row-major `2W × 2H` HALF-CELL grid, and a
  numeric-index lane's base may be pinnable by CROSS-LANE count matching: rendering candidate layouts
  as categorical PNG images instantly falsifies the wrong one (per-cell interleave drew two
  side-by-side half-res copies; row-major drew the islands), and matching each `lmlt` value's count
  against the co-located `emla` decal counts + the `[GfxLandscape].LogicType` pinned raw=typeId
  (the prior `+1` shift "verified" only because every value+1 also existed in the table — an
  existence check is not a semantics check). Visualize lanes as images and cross-correlate counts
  before trusting an indexing convention. (pipeline/format)
- [gathering-pipeline] A research/plan doc's data table is a starting point, not the extraction
  spec — RE-DERIVE it from the source. The gathering-economy plan listed 7 gathered goods; the real
  `goodtypes.ini` had **11** carrying `landscapeTo*` (adds wheat/leather/honey/meat, incl. honey with
  NO harvest lane), so the extractor keys off "any `landscapeTo*` present", not the documented list.
  Adjacent finding: a field the plan groups with a feature may be UNIVERSAL — `landscapetype` is on
  all 65 goods (the on-ground lane), so it belongs on `GoodType`, not the gathering-only sub-object.
  Scan every record for a field's real prevalence before deciding where it lives. (pipeline/format)
- [stale-content-yew-fallback] The gathering graphics (per-good nodes, ground-pile heaps, flag heaps) are
  DATA-driven off `ir.json`'s `gatheringPipeline`; with an EMPTY/old pipeline the whole render degrades
  gracefully to the yew-tree fallback + placeholder heaps — in EVERY scene, silently, no error. So a
  symlinked/stale `content/` (goods with no `gathering` sub-object → `buildGatheringPipeline` skips them
  → 0 rows) looks like "the graphics binding is broken per scene" when it's really stale data. When a task
  changes pipeline OUTPUT, honour the worktree exception: regenerate `content/` in the worktree instead of
  symlinking the primary's, else you debug a data-freshness problem as a code bug. Confirm the fix by
  inspecting `ir.gatheringPipeline.length` (should be 11), not by re-reading the binding code. (pipeline/content)
- A checked-in frame-name MAP or loader is NOT the decoded BYTES. `content/` is gitignored + regenerated
  by hand, so it lags behind added pipeline stages: the GUI window atlas, font atlases, palette LUT, and
  `gui/strings` were absent on disk though `gui-atlas-map.ts` + the `gui-gfx`/`font-gfx` loaders were long
  committed. If a "content is present" feature renders nothing, check the specific stage OUTPUT exists on
  disk, not just that the loader/map code is there. The GUI + font stages read from the GAME copy and only
  ADD files, so a targeted `convertGuiStage(game, out)` + `convertFontStage(game, out)` regenerates just
  those (additive — no full re-extract, no clobber of the 400+ existing atlases or `ir.json`). (pipeline/content)
