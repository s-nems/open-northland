---
description: Run one small roadmap iteration end-to-end — pick the smallest next step, build, test, commit, review, address, commit, done.
argument-hint: [optional focus — a roadmap item or subsystem to bias the step toward]
---

You are running **one** iteration of the Vinland work loop. Keep the working window small: do the
**smallest** next step, finish it cleanly, and stop. Read `CLAUDE.md` (golden rules: `sim` is
deterministic/pure, fixed-point ints, content-is-data, prefer mod `.ini`) before editing — it is the
contract and overrides defaults.

Optional focus from the invocation: **$ARGUMENTS** (if empty, take the default top-of-roadmap step).

This project commits **directly to `main`** — do not create a feature branch.

## 0. Check the working tree
- Run `git status` first. The tree must be clean apart from changes you are about to make.
- If there are **pre-existing uncommitted changes unrelated to this step**, do not sweep them into
  your commit and do not guess — **stop and report** them so the user can deal with them first.
  ("The diff" in later steps means *your own* changes for this step, nothing else.)

## 0.5 Reflection check — is a *rethink* due instead?
Before picking a roadmap step, judge **from git history** (not a fixed counter) whether the project
is overdue for a **reflection** pass — a deliberate health/architecture/docs/roadmap cleanup
(`/reflect`) — rather than another feature step.
- Read the recent shape: `git log --oneline -n 30` (add `--stat` for churn). If `docs/TECH-DEBT.md`
  exists, `git log -n 1 --format='%h %cs' -- docs/TECH-DEBT.md` pinpoints the last reflection and
  `git log <that-sha>..HEAD --oneline` is the feature work since.
- Weigh signals (judgment, nothing hardcoded): a long unbroken run of `feat:`/`fix:` commits with no
  `refactor:`/`docs:` breather; churn piling onto one growing file/system (it keeps getting patched →
  it wants a rework); roadmap prose drifting from the code; the same review finding recurring. The
  longer it's been and the more drift you see, the stronger the nudge. No `docs/TECH-DEBT.md` yet with
  real history behind you is itself a strong nudge to do the first reflection.
- **Structure check (objective, not vibes) — debt is created here, every iteration, and cleaned only
  in reflection, so let degradation summon its own cleanup.** Run the quick scan `/reflect` uses:
  largest sources (`find packages -name '*.ts' -not -path '*/node_modules/*' -not -name '*.test.ts' | xargs wc -l | sort -rn | head`),
  flat `src/` dirs (≥6 files, no subfolders), and executor-read doc sizes (`wc -l docs/ROADMAP.md packages/*/CLAUDE.md`).
  If any axis is **ratchet-violating** — the worst offender grew past budget (a ~300-line source / a
  newly-flat dir / a >300-line `ROADMAP.md`) since the last reflection — reflection is **due**,
  regardless of the commit-type run above. (This is the structural counter-pressure to feature growth;
  don't wait for the vibe.)
- **Decision:** if it's due, run the reflection playbook instead — read `.claude/commands/reflect.md`
  and follow it for this iteration, then stop. If not, continue with Step 1 below as a normal feature
  iteration. (Don't reflect two passes running — recent `refactor:`/`docs:` cleanup means it isn't due.)
- **Override:** if `$ARGUMENTS` names a roadmap item/subsystem, treat it as a feature step and skip the
  diversion; if `$ARGUMENTS` is `reflect`/`rethink`, go straight to `reflect.md`.

## 1. Pick the step
- Open `docs/ROADMAP.md`. The **current target** is the top unchecked milestone. Choose the
  *smallest* next concrete step toward it (a single checkbox-sized slice, not a whole phase).
- If `$ARGUMENTS` is set, bias toward that item/subsystem — but still take the smallest coherent
  step. If it names something **not on the roadmap**, prefer the nearest roadmap step it relates to;
  if it's **already done**, fall back to the top unchecked step.
- State in one line what step you're doing and why it's the next-smallest.

## 2. Do the work
- First read the per-area lessons file(s) for the code you'll touch — `docs/lessons/{sim,pipeline,render,tooling}.md`
  (index + contract: `docs/LESSONS.md`) — the loop's hard-won memory; don't re-learn those traps,
  and don't load areas the step won't touch.
- Implement only that step. Match the style of surrounding code. No scope creep — resist pulling in
  the next roadmap item even if tempting.
- Follow the determinism anti-patterns in `packages/sim/CLAUDE.md` (sim work). Mechanics change →
  add/extend a test at the **lowest level that proves it** (unit → integration → headless scenario).

## 3. Test (do not skip, do not fake)

### 3a. Automated gate
- Run `npm test`, `npm run check`, and `npm run build`. All must be green.
- If an invariant fired, it reports the exact tick — use it.
- If something fails, fix it before committing. If you genuinely can't, **stop and report** — do not
  commit broken or untested work.

### 3b. Hands-on smoke check (mandatory — this is where "passes tests" ≠ "works")
Green unit tests prove the *unit*. They do **not** prove the feature runs, because unit tests use
synthetic fixtures, tmp dirs, and absolute paths — they sidestep exactly the things that break in
real use: arg parsing, relative paths/cwd, `INIT_CWD`, env, build output, bin wiring, the `npm run …`
script glue. **The documented invocation is part of the deliverable. If you didn't run it, it isn't
verified — typechecking and green tests are not a substitute for running the actual thing.**

So before claiming done, **exercise the real entry point the way a user or the next stage invokes it**,
end-to-end, with real inputs when they exist locally:
- **Pipeline / CLI / tooling step** → run the *actual documented command* (e.g.
  `npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content`) from the repo
  root against the local game copy if present. Then **look at the output**, don't just trust exit 0:
  count emitted files, open/`file` a sample, check the reported record counts are non-zero and sane,
  diff against what you expected. A run that exits 0 but writes nothing is a failure.
- **Sim / mechanics step** → run the real `scenario()` / headless entry, not only the unit test;
  confirm the state hash / atomic trace is what you intended (and update the golden deliberately).
- **Render / visual step → the visual-confirmation gate (a hard gate, not a soft flag).** A change
  whose correctness can only be judged **by eye** — anything under `render` / the app's draw path, an
  animation, sprite/bob/atlas/palette work, a decoded *visual* asset, camera or UI layout — is **never
  "done" on green tests alone.** Automated tests and the OpenVikings oracle prove it is *structurally*
  right (frames decode, hashes match, it doesn't crash); they **cannot** prove it *looks* right —
  whether the animation reads correctly, the timing feels right, the sprite sits where it should.
  **Only the user can make that final call.** So:
  1. Do the work; get the automated gate (test/check/build) green; validate decoded assets against
     the OpenVikings oracle; run the screenshot diff if one exists.
  2. **Commit anyway** (progress is saved and git-reversible) — but **do not mark the step verified.**
     Its real status is **pending the user's visual confirmation.**
  3. Hand the user a **fast scene check**: the exact command to see it (e.g. `npm run dev`) and the
     one scene/screen to open and the one or two things to look at (e.g. "settler walk cycle loops
     smoothly facing all 8 directions; feet don't slide"). Keep it to a *glance* — the user should be
     able to eyeball it in seconds and say good / not-good.
  In an interactive `/iterate`, **stop here and ask the user to look** before considering it closed; in
  the unattended supervisor, return the pending flag + scene check (see `iterate-supervisor.js`).

If the real entry point **genuinely cannot** be exercised here (needs an owned game copy that's
absent, a GPU, or human eyes), say so **explicitly** — do not imply it was checked. "Not hands-on
verified: \<why\>" is an honest closeout; silently shipping on green units is the failure mode this
step exists to kill.

### 3c. Fidelity check (mechanics/data steps — the project's actual goal)
Green + deterministic proves *self-consistent*, not *faithful* — and faithfulness is the goal. For any
step that implements or tunes a **mechanic** or **extracts data**, state its **fidelity basis**: what
original-game behavior it matches and how that is pinned — the extracted data param, the mod's `.ini`
semantics, or the OpenVikings format-oracle — or, if you consciously diverge or can't yet pin it,
**"approximated: \<what + why\>"**. There is no automatic mechanics oracle (OpenVikings' sim is a
stub), so the ledger is manual: update **`docs/FIDELITY.md`** — move the mechanic's row to its true
status and record any conscious deviation. Pure infra/refactor/docs steps are exempt — say "fidelity
n/a: \<why\>". See `docs/FIDELITY.md`.

## 4. First commit
- Update `docs/ROADMAP.md`: tick the completed item, and revise wording if the work revealed
  something (the roadmap is meant to be edited as you learn).
- If the step touched a **mechanic or data**, update `docs/FIDELITY.md` in the same commit (the
  ledger row + any conscious deviation).
- Commit per project convention: **Conventional Commits, imperative, capitalized, no scope, no AI
  attribution** (e.g. `feat: Add A* tie-breaking on the cell graph`). Stage only the files for this step.

## 5. Review
- Your first commit is already in, so the working tree is clean — review the **commit's** diff
  (`git diff HEAD~1..HEAD`), not the empty working diff. Run `/code-review high` against it for
  correctness + simplification feedback.
- A fresh-context reviewer is the real defense against rubber-stamping your own work. **Mandatory:**
  if the change touches `sim` determinism/purity, fixed-point math, or content schemas, spawn at
  least one focused review subagent (Agent tool) with a *determinism/purity of `sim`* lens. For
  larger or trickier changes add 1–2 more lenses — *correctness/edge-cases*, *simplicity/reuse*.
  A one-line data/test tweak needs none; otherwise lean on the subagents rather than self-judgment.

## 6. Address feedback
- Triage the findings **with your own judgment** — fix what is real and in-scope; for anything you
  deliberately skip, record a one-line reason (carry these into the Step 7 closeout). Don't blindly
  apply every comment.
- Re-run `npm test` / `npm run check` if you changed code. If a re-run goes red and you can't fix
  it, **revert the review fixes** (keep the green first commit) and report — never leave the tree red.

## 7. Second commit + done
- Commit the review fixes (same convention). If review surfaced nothing worth changing, say so and
  skip the second commit rather than making an empty one.
- Report a short closeout: the step done, what the tests showed, **the exact hands-on command you
  ran in 3b and what it actually produced** (file counts / sample / record numbers — or an explicit
  "not hands-on verified: \<why\>"), **the fidelity basis from 3c** (what original behavior it matches
  + how pinned, or "fidelity n/a: \<why\>"), what review raised and how you addressed it, and the
  next-smallest step the *following* iteration should take.
- **If the step was render/visual (the 3b gate fired):** do **not** report it as verified/done —
  report it as **pending the user's visual confirmation** and include the fast scene check (the exact
  command + the one scene to open + the one or two things to look at). The work is committed, but the
  user has the final say on whether it looks right.
- If the step surfaced a non-obvious, generalizable lesson (a determinism trap, a "green tests but
  broke at the real entry point" slip), append one grounded line to the matching
  `docs/lessons/<area>.md` (`- [<sha>] <lesson> — <fix> (<area>)`; contract in `docs/LESSONS.md`)
  and stage it with the commit. Most steps add nothing — keep it lean.
- Then **stop**. Don't start another step — the user opens a fresh context window and runs
  `/iterate` again.
