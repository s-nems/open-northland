---
description: Run a user-specified task in an isolated git worktree — build, test, get approval, review; on the user's explicit go, rebase onto main and fast-forward merge (no merge commit), then clean everything up.
argument-hint: <the task to do in this worktree>
---

You are running the **worktree workflow**: like `/iterate` in discipline, but the task is specified
by the user (not picked from the roadmap) and all work happens in an **isolated git worktree**, so
several of these can run in parallel sessions without stepping on each other or on the primary
checkout. Read `CLAUDE.md` (golden rules) before editing — it is the contract and overrides defaults.

The task from the invocation: **$ARGUMENTS** (if empty, ask what the task is before doing anything).

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
  - `content/` — real graphics are the default and content is gitignored. Symlink the primary's:
    `ln -s ../vinland/content content` (run from the worktree root). **Exception:** if the task
    changes the asset pipeline's *output*, do not symlink — run `npm run pipeline` into the
    worktree's own `content/` instead, so the primary checkout's content is never clobbered.
  - `.claude/` — copy `settings.local.json` and `commands/` from the primary checkout
    (`~/Projects/vikings/vinland/.claude/`) so permissions and project commands work here.

## 2. Do the work

- Same discipline as `/iterate` step 2: skim `docs/LESSONS.md` for gotchas in the area, implement
  only the requested task, match surrounding style, no scope creep. Sim work follows the
  determinism contract in `packages/sim/CLAUDE.md`; mechanics change → a test at the lowest level
  that proves it.

## 3. Test (do not skip, do not fake)

Follow the `/iterate` §3 gates (`.claude/commands/iterate.md` — copied into this worktree in step 1):
- **3a automated:** `npm test`, `npm run check`, `npm run build` — all green, in the worktree.
- **3b hands-on:** exercise the real entry point end-to-end (documented command, real inputs) and
  look at the output — green units are not a substitute. For anything player-visible or visual:
  - Start `npm run dev` **from the worktree**. A parallel session may hold 5173 — Vite will pick
    another port; read the **actual** URL from the output, never assume.
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

## 5. Review

- Spawn parallel review subagents (Agent tool) over the branch diff vs main
  (`git diff main...HEAD`). **Mandatory** lens if the change touches `sim` determinism/purity,
  fixed-point math, or content schemas: *determinism/purity of `sim`*. For larger changes add
  *correctness/edge-cases* and *simplicity/reuse*. A trivial data/test tweak needs none.
- Triage findings with your own judgment — fix what is real and in-scope, record a one-line reason
  for anything deliberately skipped. Re-run `npm test` / `npm run check` after fixes; commit them.

## 6. Stop — report and wait for the go

Report: what was done, test evidence (the exact hands-on command and what it produced), the
approval links + checklist for anything visual, review findings and how they were addressed, and
the branch/worktree names. Then **stop**. Merge only when the user explicitly says so; if they ask
for changes instead, loop back to step 2 (the worktree stays up).

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

## 8. Cleanup

- Stop every process this workflow started (dev servers, background tasks) before removing anything.
- Verify the merge landed: `git merge-base --is-ancestor <branch> main` must succeed.
- `ExitWorktree` with `action: "keep"` (it returns the session to the primary checkout; it cannot
  delete a worktree entered via `path` — that's the next line).
- `git worktree remove --force ~/Projects/vikings/vinland-<slug>` — `--force` is only for the
  untracked node_modules and the content symlink (the symlink is removed, its target untouched);
  it is safe *because* the ancestor check above passed.
- `git branch -d <branch>` (lower-case `-d`: refuses if somehow unmerged — that refusal is signal,
  not an obstacle to `-D` past).
- Confirm `git worktree list` shows only the primary checkout, then report the closeout: the merged
  commits (`git log --oneline` of what landed on main) and that the worktree/branch/processes are gone.

**Abandoning instead of merging:** if the user says to drop the work, skip step 7; confirm once
that the branch's commits will be destroyed, then do step 8 with `git branch -D` and without the
ancestor check.
