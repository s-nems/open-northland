# Tech debt & parked reworks

Reworks **deliberately not executed yet** — *not* a structural-health to-do queue. Structure
(oversized files, flat folders, doc bloat) is owned by `/reflect`'s structure scan and **executed**,
not parked here. What lives here is only work that is genuinely **behavior-changing**,
**judgment-heavy/irreversible**, or **trigger-gated**: it waits for a condition (named per entry) and
activates when that trigger fires. Advance or prune an entry when its trigger fires or it goes stale;
a *completed* entry is clutter — delete it (git history keeps the record).

The **Reflection log** at the bottom is the git-native anchor `/iterate` reads to judge when the last
reflection happened.

For small, hard-won *gotchas* (not reworks) see [LESSONS.md](LESSONS.md); the live feature plan is
[ROADMAP.md](ROADMAP.md); the completed-work record is [ROADMAP-ARCHIVE.md](ROADMAP-ARCHIVE.md).

## Parked reworks (trigger-gated / speculative)

### 1. Edit-time determinism guard (Claude Code hook)

- **Problem.** The determinism contract (no `Math.random`/`Date.now`/`new Date`/`performance.now` in
  `sim`) is only checked when an agent runs `npm test` or CI — a violation introduced mid-edit isn't
  surfaced until the next test run.
- **Change.** A `PostToolUse` hook on `Edit|Write` matching `packages/sim/src/**.ts` that re-checks
  the four forbidden patterns and feeds violations back via exit 2.
- **Payoff.** Instant, deterministic feedback at the moment a violation is introduced — a
  verification oracle the model can't forget.
- **Trigger / why-deferred.** Small but friction-prone, and **deliberately deferred**: `hygiene.test.ts`
  already enforces this in `npm test` + CI, and `/iterate` runs `npm test` before every commit, so a bad
  pattern can't reach a commit today — the hook only buys ~1–3s earlier feedback at the cost of a
  `vitest` cold-start on *every* sim edit (+ a `jq` dependency). If adopted, implement as a
  near-instant `grep` guard mirroring `test/hygiene.test.ts:13-18`, not a vitest run (but that
  duplicates the authoritative test and can drift). `.claude/` is gitignored, so this is local tooling.

### 2. Parallel git-worktree iterations (supervisor)

- **Problem.** `iterate-supervisor` runs strictly sequentially (one commit to `main` per iteration);
  provably-independent work can't overlap.
- **Change.** For independent roadmap items, fan out N subagents on separate `git worktree`s, then
  merge clean ones (`git merge-tree` conflict check), gated behind a "remaining items touch
  non-overlapping files" heuristic.
- **Payoff.** Wall-clock speedup for independent batches.
- **Trigger / why-deferred.** Medium. Fights the bisectable one-commit-per-iteration model and our mostly
  *dependent* roadmap (each step builds on the last); merge-conflict resolution is its own logic. Only
  worth it once a genuinely-independent batch of roadmap items exists.

### 3. Spec-first / dependency-aware step picking (iterate)

- **Problem.** `/iterate` picks the *locally* smallest next step; it models neither roadmap
  dependencies nor a spec gate for larger items.
- **Change.** Model the roadmap as a dependency DAG (pick the leaf that unblocks the most), and/or a
  spec-first gate for non-trivial items.
- **Payoff.** Globally-greedy step order; fewer mid-build pivots.
- **Trigger / why-deferred.** Medium. The roadmap already serves as a lightweight spec and "smallest step"
  leans ReAct deliberately; heavyweight gating risks over-planning. Revisit if step selection starts to thrash.

### 4. Community / multi-tool docs

- **Problem.** No `CONTRIBUTING.md`, `.github/` PR+issue templates, or `AGENTS.md` (the cross-tool
  agent-instructions convention) — fine while solo + agent-driven, a gap if the project opens up.
- **Change.** Add them when the project takes human contributors or multiple agent tools. Legal
  posture is already covered (`README.md` Legal, `docs/SOURCES.md`, `CLAUDE.md`).
- **Payoff.** Lowers the contribution barrier; one canonical agent-instructions file across tools.
- **Trigger / why-deferred.** Small but premature now — activates when the project takes human
  contributors or a second agent tool.

## Reflection log

- **2026-06-30** (ROADMAP doc-bloat pass) — The one-day **building-bob render run** (~16 commits,
  `f2feda2`..`c920242`) re-bloated `ROADMAP.md` **191→424 lines** — it crossed the 300 budget *during*
  the feature run (the ratchet), each landed `[x]` item accreting its full inline "Hands-on:" trail. The
  worst offenders: the **Cross-cutting DX** section (3 completed headless cores = ~85 lines, the
  time-travel inspector alone a single 52-line paragraph), the **render-ladder rung 1** (~66 lines of
  done sub-items wrapping two live `[ ]` next-steps), and the **Phase-2 bob/terrain** trails (~70 lines).
  **Swept** every completed-item trail verbatim into `ROADMAP-ARCHIVE.md` (new dated section, +225 lines),
  collapsing each live entry to a one-line summary + `→ [archive]` pointer **while preserving the
  unchecked target detail** (rung 1's "Load the rest of the viking families" + "other tribes", rungs 2–6,
  the Phase-4 current target untouched). **`ROADMAP.md` 424→260 lines** (−39%, under budget). Docs-only —
  **golden state-hash + atomic-trace unchanged; 999 tests + check + build green.** No proposals
  added/closed. **Cadence note:** this is the *fourth* ROADMAP doc-bloat sweep (1230→113, …, 285→191,
  now 424→260) — fast feature runs re-bloat the live doc within days because each `[x]` is recorded with
  its full hands-on trail inline; the sweep is cheap and working as designed, but the re-bloat rate is
  worth watching. Next `/iterate` roadmap step (render-ladder rung 1 remainder): **load the rest of the
  viking building families** (`ls_houses_viking2/3`, `housemiller01`, `housedruid01`) so every viking
  building draws its own bob — render-only, the reducer already resolves them; ends in a human pixel
  sign-off.
- **2026-06-28** (ROADMAP doc-bloat pass) — The **read-view-surfacing vein** (~`df9847b`..`24bec38`)
  had appended a clause per landed read-view feat onto the live Phase-4 bullets until the worst —
  **"Import full base"** — was a single **79-line** run-on (the whole bullet), with Sea/Northland (27),
  Animals (22), CombatSystem (14), N-tribes (10) close behind. `ROADMAP.md` was 285 lines and the live
  *current target* was drowning in landed-narrative detail — the doc's whole purpose (a legible target)
  defeated. **Swept** the accreted "landed" read-view narrative out of all five bullets into
  `ROADMAP-ARCHIVE.md` (a new consolidated *"read-view coverage of the extracted combat / animation /
  vehicle / animal tables"* section preserving the full per-table inventory verbatim), leaving lean live
  bullets that point at the archive. **`ROADMAP.md` 285→191 lines** (−33%, well under the 300 budget),
  worst bullet 79→20. Docs-only — **golden state-hash + atomic-trace unchanged; 846 tests + check +
  build green** (the read-view names the trimmed bullets still cite were spot-checked to exist in
  `packages/sim/src`). No proposals added/closed. The self-verifiable data-extraction seam is confirmed
  **exhausted** (every extracted field on those four tables has a read view); the frontier is
  behavior-oracle-blocked. Next `/iterate` step: the only non-pixel, non-oracle-blocked Phase-4 work
  left is data/doc, so the next *feature* step likely needs the human to unblock an oracle (a running
  original / a captured trace) — otherwise the feature road waits and reflection/DX is the productive use.
- **2026-06-26** (source-ratchet pass, third of the day) — Caught a **source-file ratchet** the day's two
  earlier doc-bloat passes didn't touch: `packages/sim/src/systems/readviews/combat.ts` had grown
  **139→504 lines** (3.6× past the ~300 budget) since the prior reflection — the recent run of weapon/armor
  read-view feats had piled a whole second concern onto it. Split it by concern (the established
  five-sibling readviews precedent): `combat.ts` keeps **only** the static weapon-vs-armor *damage lookup
  table* (`combatDamage`/`weaponKey` + its row/profile types, back to **139 lines**), and a new sibling
  **`readviews/classes.ts`** (376 lines) takes the 14 data-defined **class-taxonomy** views (the
  `isRanged`/`isSiege` predicates, the `weaponClassOf`/`weaponWeightOf`/`armorClassOf`/`armorMaterialOf`/
  `armorWeightOf` accessors, and the `weaponsByClass`/`armorByClass`/`armorByMaterial`/`weaponsByJob`/
  `weaponsForJob`/`rangedWeapons`/`siegeWeapons` groupings). Barrel re-exports unchanged (split into a
  `combat.js` + `classes.js` block), so every importer/test is untouched. Pure move — **golden state-hash
  + atomic-trace unchanged; 805 tests + check + build green**. No proposals added/closed. (`classes.ts` at
  376 and `tribes.ts` at 388 are jsdoc-dense read-view modules whose *code* is small — over the soft budget
  but not a two-job split candidate; weapon+armor classification is kept together as cross-referenced
  "twin" pairs. Watch if either keeps growing.) Next `/iterate` step: resume Phase-4 read-view consumer
  coverage on a non-combat table (probe GoodType/JobType/BuildingType/VehicleType for extracted-but-unread
  fields), or flag the self-verifiable data seam as exhausted and the frontier as behavior-oracle-blocked.
- **2026-06-26** (doc-bloat pass, second of the day) — The **same ROADMAP doc-bloat ratchet recurred
  within the day**: the morning's sweep (`d049b1d`, below) had compacted `docs/ROADMAP.md` to **159
  lines**, and 21 feature iterations since each appended a multi-paragraph "now LANDED" verification
  trail to its item, re-inflating it to **320 lines** (past the ~300 executor-read budget). Same fix:
  swept the re-accreted verbatim narratives of the Phase-3 ConstructionSystem (the giant ~68-line bullet)
  + ReproductionSystem and the Phase-4 CombatSystem / N-tribes / Animals / Sea-Northland / Import-content
  items into **`docs/ROADMAP-ARCHIVE.md`** (a dated `Phase 3/4 sweep — 2026-06-26 (second pass)` block,
  text byte-preserved), and condensed each live item to a one-line-to-short-paragraph summary that keeps
  its **open/deferred** work + FIDELITY pointers visible. `ROADMAP.md` **320→185 lines**; the Phase-4
  current target reads at a glance again. Docs-only — **golden state-hash + atomic-trace unchanged**; 763
  tests + check + build green. No proposals added/closed. **The recurrence is the signal:** each
  `/iterate` writes its full hands-on trail INTO the live roadmap item, so ROADMAP re-bloats ~8 lines/
  iteration regardless of sweeps — a structural habit a future reflection or an `/iterate` convention
  tweak (write the trail to the archive, leave a one-liner live) should address at the source. Next
  `/iterate` roadmap step: the Phase-4 **Sea/Northland** boat-movement leg is oracle-blocked (no
  embark/disembark atomic in the readable `.ini`) and water-valency is map-decode-blocked; the live
  self-verifiable candidate is a further **data-overlay slice** of the Import-content item, else flag the
  three human-gated render items (Phase-1 oracle pixel-diffs / Phase-2 real-atlas bind / Phase-2 real
  terrain-tile render) for human eyes.
- **2026-06-26** (doc-bloat pass) — Ratchet caught **`docs/ROADMAP.md` 333→410 lines** (past the ~300
  executor-read budget) since the morning's structure reflection (`1e20840`, which split `readviews.ts`
  but didn't touch the roadmap): the growth was completed-work *narrative* — Phase 3's five landed items
  (Progression/Job/Construction/Reproduction/HUD) and Phase 4's CombatSystem (substance landed),
  N-tribes (scaffolding landed) and the **substance-complete** Animals item (a single 110-line bullet)
  had each re-accreted a full inline verification trail. Swept all eight verbatim into
  **`docs/ROADMAP-ARCHIVE.md`** (reflection-only — the executor never reads it; the 16 commits since the
  last sweep are byte-preserved by phrase-verified extraction) and condensed each live item to a
  one-line summary + archive pointer, marking the Animals item **[x]** (its own prose declared it
  substance-complete). `ROADMAP.md` **410→159 lines**; the Phase-4 current target now reads at a glance.
  Docs-only — **golden state-hash + atomic-trace unchanged**; 672 tests + check + build green. No
  proposals added/closed. (Noted but not actioned: `LESSONS.md` is 518 lines — reflection-only, a future
  curation candidate, secondary to the executor-read ROADMAP fixed here.) Next `/iterate` roadmap step:
  seed a real **multi-civilization** scenario exercising two playable tribes' asymmetric bindings
  end-to-end (the Phase-4 N-tribes "Next:") — or the hunter's `harvest_cadaver` (atomic 33) meat follow-up.
- **2026-06-26** (structure pass) — Ratchet caught **`systems/readviews.ts` 309→535 lines** since the last
  reflection (`9b41021`, which had just extracted it out of `shared.ts`): the read-view file had
  re-accreted three unrelated concerns — the HUD/goods projections (`tribeStocks`, `tribePopulationByJob`,
  `goodsGraph`), the static weapon-vs-armor `combatDamage` lookup, and a growing cluster of tribe/animal
  views (`playableTribes`, `isAnimalTribe`, `animalRecord`/`isAggressiveAnimal`/`herdParams`/…, `mayAttack`)
  added across the combat/animal slices. Split it into a **`systems/readviews/` directory** — `hud.ts`
  (171 lines), `combat.ts` (139), `tribes.ts` (232), and an `index.ts` barrel re-exporting all three, each
  now under the ~300-line budget. Pure
  module move: the two importers (`systems/index.ts` barrel, `systems/combat.ts`) repoint from
  `./readviews.js` to `./readviews/index.js`; no external consumer import path changed (all 15 read-view
  symbols verified still resolving through the built `@vinland/sim` `systems` namespace). Behavior-preserving
  — **golden state-hash + atomic-trace unchanged**; 623 tests + check + build green. No proposals
  added/closed. Next `/iterate` roadmap step is unchanged: the **animal-spawn/herding slice** (Phase 4) that
  places animal groups on the map via the `herdParams`/`animalHitpoints` views.
- **2026-06-25** (structure pass) — Ratchet caught **`systems/shared.ts` 146→491 lines** since the last
  reflection (`3991298`): it had become two jobs — the genuine cross-system helper *leaf* (imported by
  the per-tick systems to break import cycles) plus six accreted **terminal read views** (`tribeStocks`,
  `tribePopulationByJob`+`IDLE_JOB`, `goodsGraph`+`GoodsGraphNode`, `combatDamage`+`CombatProfile`+
  `CombatDamageRow`+`weaponKey`) the HUD/render/tests consume but **no system feeds back into a decision**.
  Extracted the read views verbatim into new **`systems/readviews.ts`** (309 lines); `shared.ts` back to
  **193** (under budget). Pure import-path move: the `systems/index.ts` barrel re-exports the same surface,
  so **no consumer import path changed** (verified the built `@vinland/sim` `systems` namespace still
  exposes all six). Behavior-preserving — **golden state-hash + atomic-trace unchanged**; 568 tests +
  check + build green. No proposals added/closed. Next `/iterate` roadmap step (Phase 4): the
  **soldier-class atomics** — the hit-resolution mechanic consuming the `combatDamage` lookup (approximated,
  no oracle; record in docs/FIDELITY.md), then the **N data-defined tribes** scaffolding.
- **2026-06-25** (pipeline-reconsider pass) — Reworked `/reflect` to fix **structure, not polish jsdoc**.
  The execution gate is now **behavior-preserving & test-provable, not diff-size**, so a large
  *mechanical* refactor (file split, folder regroup) is executed — never deferred — with the golden
  hashes as the safety net; added a first-class **structure scan** (oversized files / flat folders / doc
  bloat) with a ratchet, and the rule that a jsdoc is never the *headline* when a real structural offender
  exists. Split **ROADMAP.md 1230→113 lines**: completed phases summarized one line each, the full
  clean-room "Hands-on:" trail moved verbatim to **ROADMAP-ARCHIVE.md** (reflection-only; all 65 notes
  preserved byte-for-byte by line-range extraction), and **Phase 3 marked the true current target** (the
  stale "Phase 2 ← first real target" marker corrected). Reframed THIS file as the trigger-gated/
  speculative parking lot and pruned the two completed entries (the `systems/` split, the roadmap
  compaction). Docs/tooling-only — `npm test`/`check`/`build` untouched. Next `/iterate` step: Phase 3
  ProgressionSystem — interpret `baseRepeatCounter` into the multi-tier competence curve.
- **2026-06-24** — Surveyed history/churn, code health, docs, and roadmap. Highest-leverage finding:
  `systems/index.ts` is a growing god-module (the churn hotspot). Landed the small first step —
  extracted `System`/`SystemContext` into `systems/context.ts` and `movementSystem` into
  `systems/movement.ts` (behavior-preserving; golden hashes unchanged; 269 tests + check + build
  green). Proposed the full `systems/` split and a `ROADMAP.md` compaction as the deferred big
  reworks (both since landed — see the 2026-06-25 entry). Next `/iterate` roadmap step is unchanged:
  Phase 2's "minimal carrier moving goods between store and workplace".
- **2026-06-24** (agent-tooling pass) — Reviewed the `/iterate`+`/reflect`+supervisor skills against
  external practice and improved project health for agentic use: added the compounding-memory channel
  [LESSONS.md](LESSONS.md) (the loop already discovers gotchas that died in a gitignored report) and
  wired `/iterate` to read/write it + `/reflect` to curate it (local skill tooling); split the sim &
  pipeline contracts into per-package `CLAUDE.md` files (root keeps the crisp golden rules + a
  pointer); polished the self-validation docs (TESTING run/debug subsection, ROADMAP done-vs-pending
  clarity + archived solved risks, DATA-FORMAT IR-versioning policy, ECS atomic example); expanded the
  local permission allowlist + granted read access to the two reference siblings; added
  `handsOnEvidence`/`lesson` fields to the supervisor closeout. Logged proposals #3–#6 (the
  determinism hook deferred after weighing per-edit friction vs. the existing `npm test`/CI gate).
