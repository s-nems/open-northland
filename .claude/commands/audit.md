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

Pass each agent the exact range/scope. `code-reviewer` is the baseline and runs on any diff that
changes code; the other lenses are conditional — spawn only the ones the diff can trip, since a
lens the diff cannot trip burns tokens to produce noise. Say which you skipped and why:

- **`engine-reviewer`** — the diff touches `packages/sim`, fixed-point math, command flow, content
  schemas, a per-tick sim system, or a per-frame render/app path.
- **`gameplay-reviewer`** — the diff implements/tunes a mechanic, extracts/consumes game data,
  makes source-basis claims, or touches player-facing UI/HUD/input/camera. Tell it which half
  applies (source basis, player experience, or both). Skip for pure infrastructure/docs diffs.
- **`code-reviewer`** — every diff that changes code (source, tests, tooling config). Skip only
  when the diff touches no code at all — docs/tickets-only or regenerated data. "Small" or
  "mechanical" is not a reason to skip: short diffs still carry naming, comment-budget, and shape
  findings. Tell it to weight the architecture lens when the diff crosses package boundaries, adds
  dependencies, or creates a new system/seam.
- **A general correctness/edge-cases subagent** (`general-purpose`) — for broad or high-risk changes
  when the named lenses do not cover plain behavioral correctness. Skip for trivial doc/data tweaks.

## 3. Report (and stop)

- Merge and dedupe the findings; rank blocker → should-fix → note. Each: `file:line — the defect —
  the failure scenario — the one-line suggested fix`.
- Add your own verdict per finding (agree / disagree + why), reading the cited code first — the
  agents are wrong in both directions, and the user reads your triage, not four raw reports.
- Name what **no lens can judge**: anything visual needs the user's eyes (say which scene/URL).
- Close with one line: **merge-ready / needs fixes (which) / needs your eyes (where)**. Do not edit
  any file; if the user wants fixes applied, they will say so.
