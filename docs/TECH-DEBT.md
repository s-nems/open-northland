# Tech debt & parked reworks

Reworks **deliberately not executed yet** — *not* a structural-health to-do queue. Structure
(oversized files, flat folders, doc bloat) is owned by `/reflect`'s structure scan and **executed**,
not parked here. What lives here is only work that is genuinely **behavior-changing**,
**judgment-heavy/irreversible**, or **trigger-gated**: it waits for a condition (named per entry) and
activates when that trigger fires. Advance or prune an entry when its trigger fires or it goes stale;
a *completed* entry is clutter — delete it (git history keeps the record).

The **Reflection log** at the bottom is the git-native anchor `/iterate` reads to judge when the last
reflection happened. **Log entries are capped at ~5 lines** — the blow-by-blow lives in the commit
message; entries older than the latest two get compressed to one-liners on a later pass.

For small, hard-won *gotchas* (not reworks) see [LESSONS.md](LESSONS.md); the live feature plan is
[ROADMAP.md](ROADMAP.md); the completed-work record is [ROADMAP-ARCHIVE.md](ROADMAP-ARCHIVE.md).

## Parked reworks (trigger-gated / speculative)

### 1. Parallel git-worktree iterations (supervisor)

- **Problem.** `iterate-supervisor` runs strictly sequentially (one commit to `main` per iteration);
  provably-independent work can't overlap.
- **Change.** For independent roadmap items, fan out N subagents on separate `git worktree`s, then
  merge clean ones (`git merge-tree` conflict check), gated behind a "remaining items touch
  non-overlapping files" heuristic.
- **Payoff.** Wall-clock speedup for independent batches.
- **Trigger / why-deferred.** Medium. Fights the bisectable one-commit-per-iteration model and our mostly
  *dependent* roadmap (each step builds on the last); merge-conflict resolution is its own logic. Only
  worth it once a genuinely-independent batch of roadmap items exists.

### 2. Spec-first / dependency-aware step picking (iterate)

- **Problem.** `/iterate` picks the *locally* smallest next step; it models neither roadmap
  dependencies nor a spec gate for larger items.
- **Change.** Model the roadmap as a dependency DAG (pick the leaf that unblocks the most), and/or a
  spec-first gate for non-trivial items.
- **Payoff.** Globally-greedy step order; fewer mid-build pivots.
- **Trigger / why-deferred.** Medium. The roadmap already serves as a lightweight spec and "smallest step"
  leans ReAct deliberately; heavyweight gating risks over-planning. Revisit if step selection starts to thrash.

### 3. Community / multi-tool docs

- **Problem.** No `CONTRIBUTING.md`, `.github/` PR+issue templates, or `AGENTS.md` (the cross-tool
  agent-instructions convention) — fine while solo + agent-driven, a gap if the project opens up.
- **Change.** Add them when the project takes human contributors or multiple agent tools. Legal
  posture is already covered (`README.md` Legal, `docs/SOURCES.md`, `CLAUDE.md`).
- **Payoff.** Lowers the contribution barrier; one canonical agent-instructions file across tools.
- **Trigger / why-deferred.** Small but premature now — activates when the project takes human
  contributors or a second agent tool.

## Reflection log

- **2026-07-03** (agent-tooling pass, user-directed) — Tracked the shared `.claude/` tooling in git
  (commands / agents / workflows / settings.json); landed the **edit-time determinism guard**
  (closing the former entry #1) + `npm run scan:structure`; split LESSONS into per-area
  `docs/lessons/` files (a 731-line every-iteration read → per-area reads); `/iterate` §4 now writes
  hands-on trails **straight to ROADMAP-ARCHIVE** (the recurring re-bloat fixed at its source);
  added golden rule 7 (RTS-scale perf budgets) + the named reviewer agents (determinism / perf /
  fidelity) + biome `noUnusedImports`/`noUnusedVariables` as errors (10 dead symbols removed).
  Older log entries below compressed to one-liners (full narratives in git history).
- **2026-07-01** (render-scale + sim-scale slice; 3 review agents) — Landed the retained `WorldRenderer`
  (pool + viewport-culled terrain chunks) and the sim scaling tier-1/2 (memoized `canonicalEntities`,
  per-tick candidate lists, dormancy gate, `TileBuckets`) — see `docs/ROADMAP.md` and the per-package
  `CLAUDE.md`s. Deferred cleanups surfaced by review, none blocking (all tests + check green):
  (a) **`buildScene` is off the live render path** — `WorldRenderer` projects terrain itself + consumes
  `buildSpriteScene`; `buildScene` now survives only as the headless projection/ordering oracle its
  tests pin (`scene.test.ts`, `scene.integration.test.ts`, `vertical-slice.test.ts`). Keep it OR fold
  those tests onto `buildSpriteScene` + a terrain-projection test and drop it. Its terrain projection
  duplicates `WorldRenderer.buildFlatTerrain`/`buildTexturedTerrain`; both call the same `terrain.ts`
  helpers so they can't silently diverge, but the duplication is real. (b) **No render spatial index** —
  sprite cull is an O(entities) per-frame test; a `ScreenMap`-style index (query = O(visible)) is the
  next render-scale rung. (c) **Sim tier-3** (ring-search nearest-X, content-index Map, sim→Web Worker)
  tracked in ROADMAP. (d) latent: `WorldRenderer.textureFor` keys the cache by `AtlasFrame` identity
  (assumes 1 frame ↔ 1 source; holds today).
- **2026-06-30** (ROADMAP doc-bloat pass) — Fourth ROADMAP sweep (424→260 lines) after the one-day
  building-bob run re-accreted inline trails; root cause (iterations writing trails into the live doc)
  since fixed at the source (2026-07-03). Docs-only; goldens + 999 tests green.
- **2026-06-28** (ROADMAP doc-bloat pass) — Swept the read-view vein's accreted landed-narrative
  (285→191 lines; worst bullet 79→20). Confirmed the self-verifiable data-extraction seam exhausted;
  the frontier is behavior-oracle-blocked. Goldens + 846 tests green.
- **2026-06-26** (source-ratchet pass, third of the day) — `readviews/combat.ts` 139→504 caught; split
  the 14 class-taxonomy views into `readviews/classes.ts` (barrel unchanged). Goldens + 805 tests green.
- **2026-06-26** (doc-bloat pass, second of the day) — ROADMAP re-bloated 159→320 within the day;
  swept to 185. The recurrence was the signal that trails belong in the archive, not the live doc.
- **2026-06-26** (doc-bloat pass) — ROADMAP 410 lines caught; swept eight landed Phase-3/4 item trails
  to the archive → 159 lines; marked Animals `[x]`. Goldens + 672 tests green.
- **2026-06-26** (structure pass) — `systems/readviews.ts` 309→535 caught; split into
  `readviews/{hud,combat,tribes}.ts` + barrel (no consumer import changed). Goldens + 623 tests green.
- **2026-06-25** (structure pass) — `systems/shared.ts` 146→491 caught; extracted the six terminal
  read views into `systems/readviews.ts` (barrel unchanged). Goldens + 568 tests green.
- **2026-06-25** (pipeline-reconsider pass) — Reworked `/reflect` to *execute* structure
  (behavior-preserving gate, ratchet, structure scan; jsdoc never the headline); split ROADMAP
  1230→113 (archive born); reframed this file as the trigger-gated parking lot.
- **2026-06-24** (agent-tooling pass) — Added the LESSONS memory channel + per-package `CLAUDE.md`
  contracts; wired `/iterate`/`/reflect` to read/write/curate them; expanded local permissions +
  sibling read access; added supervisor closeout fields. Logged proposals #3–#6.
- **2026-06-24** — First reflection: extracted `systems/context.ts` + `movementSystem` from the
  growing `systems/index.ts` god-module; proposed the full `systems/` split + ROADMAP compaction
  (both since landed).
- **2026-07-03** (unit-orders worktree; perf review) — Landed RTS unit orders (Owner model, moveUnit/
  setJob, idle-spacing de-stack, group formation, selection rings, always-on info panel, per-entity
  sprite bounds for pixel-accurate picking). Per-frame costs the diff introduced were addressed (pooled
  selection rings, reused frame snapshot in `controls.tick`, in-place `boundsFrame`-stamped sprite bounds
  — no per-frame alloc). **Deferred (pre-existing, not from this diff; negligible at the current few-tens-
  of-entities slice, hot only when a selection is held at thousands):** (a) `SelectionLayer.draw` scans
  all `snapshot.entities` each frame while any selection is held (O(entities), wants O(selection)); (b)
  `unit-panel.ts` `tick` does `snapshot.entities.find(...)` per selected settler each frame. Both want a
  **by-id lookup on `WorldSnapshot`** — but the snapshot is contractually "plain data, no live Maps"
  (transferable to a render Worker; `snapshot-transferable.test.ts`), so the index must be a parallel
  array/typed structure or a render-side per-frame map shared by both consumers, not a `Map` on the
  snapshot. Sequenced after the `ScreenMap` sprite index (same O(entities)-cull family, item (b) above).
- **2026-07-03** (tree-felling worktree; perf review) — Landed faithful multi-hit harvest + drop-on-ground
  (felling). The per-tick collect scan was given its own `GroundDrop` candidate list + a good→harvestAtomic
  index (O(drops), ~0 when none) so it never walks the full stockpile list, addressing the reviewer's
  should-fix. **Deferred (render-side, not a sim hot-loop concern):** a felled tree leaves a permanent
  `Stump` decor entity (never reaped), so a fully-felled large forest accumulates ~tens of thousands of
  drawable stumps that stay in the per-frame O(entities) sprite cull (`packages/render/CLAUDE.md`). It is
  net-neutral vs the old "leave the depleted node in place" behaviour and the planner never scans stumps
  (they carry no Resource/Stockpile/Building marker), but eventually wants a decay/pool or a static
  terrain-decor layer (sequenced with the `ScreenMap` sprite index — same O(entities)-cull family).
- **2026-07-05** (gathering-mining worktree; carried-good colour fix) — The player-colour LUT no longer remaps
  **patch 15** (idx 240–255) so a hauled good keeps its natural colour (the "blue wood" bug: carried goods
  live on patch 14 + 15, and the shared LUT was overwriting patch 15 with the team ramp). **Deferred —
  WOMEN's team colour:** the original binds patch 15 to women's dress (`woman_NN`) but patch 10 to men
  (`player_NN`), and a single `256×N` LUT can't remap a DIFFERENT band per body-class from one row (patch 15
  is women's-dress AND every body's carried-good band, so it's one-or-the-other). Reproducing women's dress
  colour needs a **per-body-class ramp**: build the LUT with man rows (patch 10 + 5) and woman rows (patch 15
  + 5), and have `SpritePool` pick the row block by the settler's body sex (the roster already knows it). Low
  urgency (no women in the current scenes; men are the haulers the fix targets). See docs/FIDELITY.md "Player
  (team) colours" divergence (b).
