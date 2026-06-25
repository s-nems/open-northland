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
