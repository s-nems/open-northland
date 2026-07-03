---
description: Stop and rethink — one reflection pass on project health (structure/code/architecture/docs/roadmap). Scan for the worst structural-health offender (oversized files, flat folders, doc bloat), execute a behavior-preserving fix however large (golden hashes are the safety net), defer only behavior-changing or speculative reworks, commit, review, done.
argument-hint: [optional lens — e.g. "docs", "roadmap", "sim/systems", or a specific class/module to scrutinize]
---

You are running **one** *reflection* pass — the deliberate counterpart to `/iterate`. Instead of
advancing the roadmap, you **stop and rethink**: improve the project's *health* — **structure** (file
size, folder grouping, doc size), code quality, architecture, type safety, and docs/roadmap accuracy.
Think like a senior engineer doing a walkthrough: look widely, weigh leverage, act surgically. Read
`CLAUDE.md` first — its golden rules bind any code you touch (`sim` is deterministic/pure, fixed-point
ints, content-is-data, prefer the mod's `.ini`). This project commits **directly to `main`** — do not
create a feature branch.

**Execute structure; defer only the unsafe or speculative.** The gate on what you *commit* is whether
the change is **behavior-preserving and test-provable** — *not* how big the diff is. A mechanical file
split or folder regroup touching 30 files is low-risk *because* the golden state-hash + atomic-trace
tests prove behavior didn't change: **do it, don't defer it.** Route to `docs/TECH-DEBT.md` only the
reworks that are genuinely **behavior-changing**, **judgment-heavy/irreversible**, or
**speculative/trigger-gated** (they wait for a condition — e.g. parallel worktrees waiting for an
independent batch). The old failure mode this pass exists to kill: deferring every large-but-mechanical
structure fix and committing a lone jsdoc instead.

Optional lens from the invocation: **$ARGUMENTS** (if empty, survey broadly and choose the
highest-leverage item yourself).

## 0. Check the working tree
- Run `git status` first. The tree must be clean apart from changes you are about to make.
- If there are **pre-existing uncommitted changes unrelated to this pass**, do not sweep them into
  your commit and do not guess — **stop and report** them so the user can deal with them first.

## 1. Survey (the reflective core — do not shortcut this)
Look across several lenses and **generate multiple candidate improvements before choosing**. Use
`Explore`/`general-purpose` subagents to fan out for breadth when it helps (keep your own context lean
— ask them for findings, not file dumps).
- **Structure scan (run this first — it must yield a candidate).** Run `npm run scan:structure` — it
  measures the three structural-health axes (oversized sources / flat folders / doc budgets) against
  their ~300-line budgets. The metric is the *trigger to look*; your judgment is the verdict. The
  **ratchet**: an offender that *grew* since the last reflection (`git diff --stat` vs. the last
  reflection SHA) is the prime suspect — structure must not be allowed to drift worse.
  - **Oversized files** — a flagged source is a split *candidate*; confirm it genuinely does multiple
    jobs before splitting.
  - **Flat folders** — a flagged dir (or one whose files obviously cluster) wants grouping. Keep the
    determinism-critical `sim` layout legible; folder moves are import-path-only and golden-proven.
  - **Doc bloat** — a flagged **executor-read** doc drowns the live signal: sweep completed roadmap
    items to `docs/ROADMAP-ARCHIVE.md` (reflection-only — the executor never reads it); curate the
    `docs/lessons/` area files (promote/prune) rather than letting them grow.
- **History & churn** — `git log --oneline -n 30` (add `--stat`). What's been built since the last
  reflection? Where is churn concentrated? A file/system that keeps getting patched is a rework
  candidate. Read `docs/TECH-DEBT.md`: trigger-gated entries whose trigger has now fired, and the last
  reflection anchor.
- **Code health** — skim the fastest-growing modules. Smells beyond raw size: duplicated logic, a
  swelling `switch`, a leaky or worked-around abstraction, weak/implicit types, a "unit" test that's
  really an integration test, a system file accreting unrelated helpers (e.g. `systems/ai.ts`).
- **Architecture** — is the current shape still serving the road ahead? Any decision visibly
  straining? Anything you keep coding *around* instead of fixing?
- **Performance ratchet (golden rule 7 — this is an RTS headed for lockstep multiplayer).** Did a
  recent slice add a full-world scan inside a per-entity loop (sim) or per-frame object churn /
  map-scaled work (render)? Grep the churn hotspots for the anti-patterns named in
  `packages/sim/CLAUDE.md` "Scaling to thousands" / `packages/render/CLAUDE.md`. If a sim system
  looks suspect, *measure* (per-system timers over `dist/` in a throwaway script — never
  `performance.now` in `src`) rather than guessing; a confirmed regression is a prime candidate,
  and the fix must stay golden-proven (elide only provably-null work).
- **Docs drift & cadence** — do `ARCHITECTURE.md` / `ECS.md` / `DATA-FORMAT.md` / `TESTING.md` still
  match the code (a recent slice may have added a component/system/invariant the docs never caught)?
  Classify every doc by read-cadence — *always-on* (`CLAUDE.md` golden rules) stays lean; *on-demand*
  (per-package `CLAUDE.md`, `DATA-FORMAT`, `ECS`) loads only where relevant; *reflection-only*
  (`TECH-DEBT`, `LESSONS`, `FIDELITY`, `ROADMAP-ARCHIVE`) the executor needn't read at all. JSDoc/
  comments earn their keep only when they encode the **non-derivable** (why / invariant / units /
  fidelity-source / gotcha) — prune any that merely **restate the code**.
- **Fidelity direction** (the project's actual goal) — read `docs/FIDELITY.md`. Are landed mechanics
  pinned to an original-game source, or quietly `approximated` with no calibration recorded? Lots of
  green tests over a thin/`not-started` mechanics ledger is *drift hiding behind self-consistency* —
  often the highest-leverage thing to surface. Tend the ledger: move rows to their true status, record
  conscious deviations, flag mechanics that need calibration-by-observation.

## 2. Choose the highest-leverage improvement
From your candidates pick the one with the best **leverage** — what it unblocks, how much
legibility/safety it buys. The **execution gate is whether the change is behavior-preserving and
test-provable** (the golden state-hash + atomic-trace tests stay byte-identical), **not the size of
the diff**: a 30-file mechanical reorg passes the gate; a 5-line behavior change may not.
- **Rank structural offenders above cosmetics.** A ratchet-violating structural offender (a
  file/dir/doc that grew past budget since the last reflection) outranks everything else. **A
  jsdoc/comment tweak or a lone type-tightening is NOT an acceptable *primary* deliverable when the
  Step 1 scan shows a real structural offender** — cosmetic polish may ride along, but it is never
  the headline.
- **Defer only the genuinely unsafe or speculative** (→ Step 5): behavior-changing reworks,
  judgment-heavy/irreversible ones, or trigger-gated ideas. If a structural fix is too big to land
  cleanly in one pass, **do not defer it** — land it as a short series of golden-proven commits.

State in one line what you'll do and why it's the highest-leverage step.

## 3. Do the work
One improvement, surgical — no scope creep into a *different* axis. But a structural fix may be
**large** as long as it stays mechanical: a **refactor must be behavior-preserving** (same observable
sim behavior, just better-organized). If it's too big for one clean commit, land it as a **short
series of per-unit, golden-proven commits** (the `systems/` split is the precedent). Golden rules
apply to any `sim` code (determinism/purity, fixed-point, content-is-data). Match the surrounding style.

## 4. Test (the refactor safety net — do not skip, do not fake)
Run `npm test`, `npm run check`, and `npm run build` — all must be green.
- For a **refactor**: the golden state-hash + atomic-trace tests staying **byte-identical** is your
  proof that behavior didn't change. **Do not update a golden** for a refactor — if a golden moves,
  you changed behavior: stop and reassess (it isn't a pure refactor, or you introduced a bug).
- For **docs/roadmap-only**: code tests should be untouched; still run them.
- If you touched tooling, **exercise the real entry point** end-to-end and look at the output (see
  `iterate.md` §3b — green units are not proof the thing runs).
- If the pass touched **render/visual code** — even a "behavior-preserving" refactor — the golden
  hashes prove the *sim* is unchanged but say **nothing about pixels**: a render reorg can still shift
  what's on screen. The **visual-confirmation gate** (`iterate.md` §3b) applies. Commit, but mark it
  **pending the user's visual confirmation** and hand over the fast scene check (the exact command +
  the one scene to open + the one or two things to look at). Only the user signs off that it still
  looks right — a refactor is not closed until they have.

## 5. Defer only the unsafe or speculative (the parking lot)
`docs/TECH-DEBT.md` is the **trigger-gated / speculative reworks** parking lot — *not* a
structural-health to-do queue (Step 1's scan owns structure, and you **execute** it in Step 3).
Record here only what you deliberately did **not** do because it is **behavior-changing**,
**judgment-heavy/irreversible**, or **waiting for a trigger** (e.g. parallel worktrees until a
genuinely-independent batch appears). Each entry carries: **problem**, **change**, **payoff**,
**trigger/why-deferred**. Advance or prune any prior entry whose trigger has fired or that has gone
stale — a *completed* entry is clutter, delete it (git history keeps the record).

Also **tend the lessons files** (`docs/lessons/*.md` — the loop's hard-won gotchas, grounded in
commit SHAs; contract in `docs/LESSONS.md`): promote any recurring / rule-worthy lesson into
`CLAUDE.md` (or the package `CLAUDE.md`) and prune it from the area file, drop entries the code has
made obsolete, and keep each area file under the ~300-line budget (`sim.md` is the standing
hotspot). This curation is the anti-bloat valve that keeps the compounding memory honest — without
it, lessons accumulate and poison context.

Likewise tend **`docs/FIDELITY.md`** when the pass touches mechanics: keep the conformance ledger
honest as mechanics land or get calibrated, and surface any mechanic running on an unrecorded
approximation (that, not a failing test, is how fidelity drift shows up).

## 6. First commit
- Append a **Reflection log** entry to `docs/TECH-DEBT.md` — **at most ~5 lines**: date, what you
  improved, the one before→after metric, proposals added/closed, and the next roadmap step. The
  blow-by-blow lives in the commit message, not the log (past entries ran 20+ lines and bloated the
  doc). This entry is also the git-native anchor the next `/iterate` reads to judge when the last
  reflection was.
- Commit per project convention — **Conventional Commits, imperative, capitalized, no scope, no AI
  attribution** — using the honest type for the work: `refactor:` / `docs:` / `test:` / `chore:`.
  Stage only this pass's files (the change + `docs/TECH-DEBT.md`).

## 7. Review, address, second commit, done
- Review the **commit's** diff (`git diff HEAD~1..HEAD`) with `/code-review high`.
- **Mandatory** for any `sim` refactor: spawn the **`determinism-reviewer`** agent
  (`.claude/agents/`) — a refactor that quietly breaks determinism is the exact failure mode this
  guards. If the pass touched a per-tick system or per-frame render path, add **`perf-reviewer`**.
  For wider changes add a *correctness/edge-cases* lens too.
- Triage with your own judgment — fix what's real and in-scope; for anything you skip, record a
  one-line reason. Re-run `npm test` / `npm run check` if you changed code. If a re-run goes red and
  you can't fix it, **revert the review fixes** (keep the green first commit) and report — never leave
  the tree red.
- Second commit for the review fixes (skip it, and say so, if nothing was worth changing).
- Closeout: what you improved and its leverage; what tests showed (for a refactor say explicitly
  **"golden hashes unchanged — behavior preserved"**); the proposals you logged for later; what
  review raised and how you addressed it; and the next-smallest **roadmap** step the following
  `/iterate` should resume with (reflection is a breather — point back at the feature road). **If the
  pass touched render/visual code, report it as pending the user's visual confirmation with the fast
  scene check — not closed.** Then **stop** — don't start another pass.
