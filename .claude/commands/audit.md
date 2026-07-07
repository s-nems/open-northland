---
description: Run the project's review lenses over a diff and report ranked findings — review only, applies nothing.
argument-hint: [what to review — a git range, a branch, or paths; default: working diff, else branch diff vs main, else HEAD~1..HEAD]
---

You are running a **review battery** over a diff using the project's named reviewer agents
(`.claude/agents/`). This is the pre-filter for the user's own manual verification: **report
findings, apply nothing** — the user decides what gets fixed.

## 1. Resolve what to review

- `$ARGUMENTS` names a range / branch / paths → review exactly that.
- Otherwise: a dirty working tree → the working diff (staged + unstaged); on a non-`main` branch
  with a clean tree → `git diff main...HEAD`; on clean `main` → `HEAD~1..HEAD`.
- State in one line what you are reviewing (the exact range and its headline stat).

## 2. Spawn the lenses (in parallel, one message)

Pass each agent the exact range/scope. Spawn only the lenses the diff can trip — and say which you
skipped and why:

- **`determinism-reviewer`** — the diff touches `packages/sim`, fixed-point math, command flow, or
  content schemas.
- **`perf-reviewer`** — the diff touches a per-tick sim system or a per-frame render/app path.
- **`fidelity-reviewer`** — the diff implements/tunes a mechanic, extracts/consumes game data, or
  makes source-basis claims.
- **`architecture-reviewer`** — the diff crosses package boundaries, adds dependencies, creates a new
  system/seam, changes workflow/docs architecture, or reshapes data flow.
- **`code-quality-reviewer`** — any non-trivial code change, larger refactor, new system, or risky
  test change.
- **A general correctness/edge-cases subagent** (`general-purpose`) — for broad or high-risk changes
  when the named lenses do not cover plain behavioral correctness. Skip for trivial doc/data tweaks.

## 3. Report (and stop)

- Merge and dedupe the findings; rank blocker → should-fix → note. Each: `file:line — the defect —
  the failure scenario — the one-line suggested fix`.
- Add your own verdict per finding (agree / disagree + why) — the agents can be wrong, and the user
  reads your triage, not four raw reports.
- Name what **no lens can judge**: anything visual needs the user's eyes (say which scene/URL).
- Close with one line: **merge-ready / needs fixes (which) / needs your eyes (where)**. Do not edit
  any file; if the user wants fixes applied, they will say so.
