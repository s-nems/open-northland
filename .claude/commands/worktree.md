---
description: Run a user-specified task in an isolated git worktree — build, test, get approval, review; on the user's explicit go, rebase onto main and fast-forward merge (no merge commit), then clean everything up.
argument-hint: <the task to do in this worktree>
---

You are running the **worktree workflow — the project's PRIMARY workflow**: the task and its plan
come from the user (not from the roadmap), and all work happens in an **isolated git worktree**, so
several of these can run in parallel sessions without stepping on each other or on the primary
checkout. Read `CLAUDE.md` (golden rules) before editing — it is the contract and overrides defaults.

The task from the invocation: **$ARGUMENTS** (if empty, ask what the task is before doing anything).

**The user's plan is authoritative.** `$ARGUMENTS` may be a one-line task, a multi-step plan pasted
inline, or a path to a plan file — when it is a plan, execute its steps and scope **as written**: do
not substitute your own step selection, do not pull in adjacent work, do not "improve" the scope.
If reality contradicts the plan (a step is impossible, already done, or clearly wrong once you see
the code), stop at the smallest safe point and **surface the deviation in the report** — the user
decides, not you. The user verifies the work manually afterward, so a faithful, legible execution
of the stated plan beats a cleverer unrequested one.

Two hard gates in this flow:
- **Never touch the primary checkout** (`~/Projects/vikings/vinland`) until the final merge step —
  another session may be working there.
- **Never merge without the user's explicit go** ("merge", "go on", …). Steps 1–6 end with a report
  and a stop.

## 1. Create the worktree

- Derive a short kebab-case slug from the task. Branch name: `feat/<slug>` (or `fix:`/`refactor:`
  type prefix as appropriate). Worktree path: **`~/Projects/vikings/vinland-<slug>`** — a sibling of
  `vinland/` inside the workspace, so the relative reference paths (`../Cultures 8th Wonder`,
  `../OpenVikings_reversing`, the pipeline's `--game` arg) resolve exactly as they do from the
  primary checkout. If the directory already exists, pick a different slug.
- Create it **based on `main`**, not on whatever the primary checkout happens to have checked out:
  `git -C ~/Projects/vikings/vinland worktree add ../vinland-<slug> -b <branch> main`
- Switch this session into it with the `EnterWorktree` tool (`path: <worktree>`), so edits and
  commands run there without permission friction.
- Provision what a fresh checkout lacks (all gitignored, so none of this can leak into the branch):
  - `npm install` (workspaces; node_modules is per-worktree).
  - `content/` — real graphics are the default and content is gitignored. Give the worktree its
    **own APFS clone** of the primary's content (run from the worktree root):
    `cp -Rc ../vinland/content content` — `-c` is clonefile: ~5 s for the full 1 GB, near-zero disk
    (blocks are shared copy-on-write until a file is rewritten). **Never symlink it**: the pipeline
    writes through the path without clearing it, so a symlinked content would silently clobber the
    primary checkout's copy in place (the pipeline CLI now refuses a symlinked `--out` for exactly
    this reason). With a clone, re-running `npm run pipeline` in the worktree is always safe — no
    "does this task change pipeline output?" judgment call needed.
  - `.claude/settings.local.json` — copy it from the primary checkout
    (`~/Projects/vikings/vinland/.claude/`) so local permissions apply here. The shared tooling
    (`commands/`, `agents/`, `workflows/`, `settings.json`) is tracked and arrives with the checkout.

## 2. Do the work

- Same discipline as `/iterate` step 2: read the matching `docs/lessons/<area>.md` for gotchas, implement
  only the requested task, match surrounding style, no scope creep. Sim work follows the
  determinism contract in `packages/sim/CLAUDE.md`; mechanics change → a test at the lowest level
  that proves it.

## 3. Test (do not skip, do not fake)

Follow the `/iterate` §3 gates (`.claude/commands/iterate.md` — copied into this worktree in step 1):
- **3a automated:** `npm test`, `npm run check`, `npm run build` — all green, in the worktree.
- **3b hands-on:** exercise the real entry point end-to-end (documented command, real inputs) and
  look at the output — green units are not a substitute. For anything player-visible or visual:
  - Start the dev server **from the worktree on a non-5173 port** — 5173 is reserved for the primary
    `main` checkout, so opening `localhost:5173` always lands on main and never a worktree's build.
    Launch with an explicit port at 5174+:
    `npm run dev --workspace @vinland/app -- --port 5174` (if 5174 is itself taken by another
    worktree, Vite walks up to the next free port). **Read the actual URL from the output** and use it
    for the browser drive + approval links below — never assume a port. `scripts/dev-ports.sh` lists
    every running dev server with its port and checkout, so you can see what's already taken.
  - Drive it yourself with the Playwright MCP tools against that port (load the scene, interact,
    screenshot) to catch crashes and obvious breakage.
  - Then hand the user the approval links: `open` the exact URL(s) (`http://localhost:<port>/?scene=<id>`
    etc.) and give the one-or-two-things-to-look-at checklist. **Visual correctness is the user's
    call — never self-sign it**; report such work as *pending visual confirmation*.
- **3c fidelity:** if the task implements/tunes a mechanic or extracts data, state its fidelity
  basis and update `docs/FIDELITY.md` in the same commit ("fidelity n/a: <why>" for pure infra).

## 4. Commit

- Commit on the branch, in the worktree. Conventional Commits, imperative, capitalized, no scope,
  no AI attribution. Stage only this task's files. Multiple commits are fine if the task has
  natural stages — history stays as-is through the rebase-merge.
- **Ledger discipline rides with the commit** (this workflow must keep the docs honest even when
  `/iterate` sits idle): if the task completes or advances a `docs/ROADMAP.md` item, tick/update it —
  the verification trail goes into `docs/ROADMAP-ARCHIVE.md`, the live line stays a 1–2-line summary
  + `→ [archive]` pointer. A non-obvious generalizable lesson → one grounded line in the matching
  `docs/lessons/<area>.md`. (FIDELITY is already handled in §3c.)

## 5. Review

- Spawn parallel review subagents (Agent tool) over the branch diff vs main
  (`git diff main...HEAD`), using the named lenses in `.claude/agents/`: **`determinism-reviewer`
  mandatory** if the change touches `sim` determinism/purity, fixed-point math, or content schemas;
  **`perf-reviewer` mandatory** for a per-tick system or per-frame render path;
  **`fidelity-reviewer`** for mechanic/data work. For larger changes add *correctness/edge-cases*
  and *simplicity/reuse*. A trivial data/test tweak needs none.
- Triage findings with your own judgment — fix what is real and in-scope, record a one-line reason
  for anything deliberately skipped. Re-run `npm test` / `npm run check` after fixes; commit them.

## 6. Stop — report and wait for the go

Report: what was done **against the user's plan, step by step** (done / deviated + why / blocked —
deviations are the user's call, so flag them loudly), test evidence (the exact hands-on command and
what it produced), the approval links + checklist for anything visual, review findings and how they
were addressed, and the branch/worktree names. Add one FYI line if `npm run scan:structure` shows an
offender this branch pushed over budget (fixing structure is out of scope unless the plan asked).
Then **stop**. Merge only when the user explicitly says so; if they ask for changes instead, loop
back to step 2 (the worktree stays up).

## 7. Merge — rebase style, no merge commit (only after the user's go)

- **Re-read main now** — parallel sessions land work on it mid-flight, so the value from step 1 is
  stale. There is no remote in this repo; `main` is a local branch (nothing to fetch or push).
- In the worktree: `git rebase main`. Resolve conflicts here. If main had moved or there were
  conflicts, re-run `npm test` + `npm run check` before continuing (and redo the hands-on check if
  a conflict touched the feature's area).
- Fast-forward `main` onto the rebased branch — never a merge commit:
  - If the primary checkout is **on `main` and clean** → `git -C ~/Projects/vikings/vinland merge
    --ff-only <branch>` (keeps its working tree in sync with the new main).
  - If the primary checkout is **on another branch** → from the worktree: `git fetch . <branch>:main`
    (fetch refuses non-fast-forward updates and refuses if main is checked out anywhere — both are
    safety checks working for you).
  - If the primary checkout is **on `main` but dirty** → **stop and report**; a parallel session is
    likely mid-task there. Do not stash, reset, or otherwise touch its state.
- **Regenerate the primary's assets** if any merged commit touches the pipeline's *output* — an
  extractor/stage/decoder under `tools/asset-pipeline/` or a content schema in `packages/data/`
  (test-only changes don't count; when unsure, regenerate — it is idempotent). Worktree content is
  an isolated clone, so the merge did **not** update the primary's `content/` as a side effect, and
  main's content must always match main's pipeline. Run it now, from the **primary** checkout:
  `npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content`
  (the script rebuilds first). Read the per-stage summary lines and confirm none failed. Only if a
  parallel session owns the primary (the dirty case above) leave it — and flag the stale content
  loudly in the closeout report instead.

## 8. Cleanup

- Stop every process this workflow started (dev servers, background tasks) before removing anything.
- Verify the merge landed: `git merge-base --is-ancestor <branch> main` must succeed.
- `ExitWorktree` with `action: "keep"` (it returns the session to the primary checkout; it cannot
  delete a worktree entered via `path` — that's the next line).
- `git worktree remove --force ~/Projects/vikings/vinland-<slug>` — `--force` is only for the
  untracked node_modules and the content clone (the worktree's own copy; the primary's content is
  untouched); it is safe *because* the ancestor check above passed.
- `git branch -d <branch>` (lower-case `-d`: refuses if somehow unmerged — that refusal is signal,
  not an obstacle to `-D` past).
- Confirm `git worktree list` shows only the primary checkout, then report the closeout: the merged
  commits (`git log --oneline` of what landed on main), that the worktree/branch/processes are gone,
  and — when the pipeline's output changed — that the primary's `content/` was regenerated (quote a
  pipeline summary line, or the loud stale-content flag if regeneration had to be skipped).

**Abandoning instead of merging:** if the user says to drop the work, skip step 7; confirm once
that the branch's commits will be destroyed, then do step 8 with `git branch -D` and without the
ancestor check.
