---
description: Execute a user-specified Vinland task in an isolated git worktree, verify it, close its ticket, wait for approval, then review and fast-forward merge.
argument-hint: <task, tickets/<area>/<name>.md, or legacy docs/plans/<file>.md step>
---

You are running the **primary Vinland workflow**. Work items live as tickets under `tickets/` (one
file = one task; `docs/plans/` is legacy — read it when named, never add to it) and the user manually
invokes `/worktree` for one task at a time. Execute the requested scope faithfully in an isolated git
worktree, report for manual verification, and merge only after the user explicitly says to merge.

The task from the invocation: **$ARGUMENTS**. If it is empty, ask for the task before doing anything.

Hard rules:
- Read `AGENTS.md` before editing. Load package-local `AGENTS.md` only for packages you touch.
- The user's task/ticket is authoritative. Do not substitute your own next step or pull adjacent work.
- Never touch the primary checkout (`~/Projects/vikings/vinland`) until the final merge step.
- Never merge without explicit user approval.
- Before merge, close the executed ticket (or update the legacy plan file) so progress survives
  across worktree sessions — and file NEW tickets for real work you discovered but deferred.

## 1. Create the Worktree

- Derive a short kebab-case slug. Branch name: `feat/<slug>` or the honest conventional type
  (`fix/<slug>`, `refactor/<slug>`, `docs/<slug>`). Worktree path:
  `~/Projects/vikings/vinland-<slug>`.
- Create it from `main`, regardless of the primary checkout's current branch:
  `git -C ~/Projects/vikings/vinland worktree add ../vinland-<slug> -b <branch> main`.
- Switch this session into that path with the available worktree/session tool.
- Provision gitignored local state if missing:
  - `npm install`
  - clone real generated content from the primary checkout when needed:
    `cp -Rc ../vinland/content content`. Do not symlink `content/`; the pipeline writes in place.
  - copy `.claude/settings.local.json` from the primary checkout if the local Claude session needs it.

## 2. Understand the Step

- If `$ARGUMENTS` names a ticket (`tickets/<area>/<name>.md`) or a legacy plan step, open it and
  identify exactly one task to execute.
- Re-check factual claims against source files before coding. Tickets and plans are research notes,
  not ground truth.
- If the step is already done, impossible, or contradicted by code/source reality, stop at the
  smallest safe point and report the deviation. The user decides the new scope.

## 3. Do the Work

- Keep edits scoped to the requested step.
- Mechanics and extracted data must name their source basis in the changed code, tests, plan progress
  note, or commit message: extracted `.ini`/`.cif` data, OpenVikings format oracle, or observation of
  the running original. If behavior is approximated, say what is approximated and why.
- Do not create new running ledgers for lessons, tech debt, fidelity, or roadmap state. Durable rules
  belong in `AGENTS.md` or package-local `AGENTS.md`; planned future work is a ticket under
  `tickets/<area>/` (one self-contained task per file — see `tickets/README.md`; never add to the
  legacy `docs/plans/`).

## 4. Verify

Run the gates that match the change, and do not fake them:
- Normal code path: `npm test`, `npm run check`, `npm run build`.
- Pipeline/data path: run the real pipeline command when extraction output or schema behavior changes:
  `npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content`.
- Player-visible or visual path: start the dev server from the worktree on a non-5173 port, use the
  actual printed URL, exercise the relevant scene/page, and report the URL plus a short checklist for
  the user. Visual and audio correctness require the user's sign-off.
- Before surfacing anything visual, look at a screenshot yourself (`npm run shot`, or a headless
  capture of the scene URL) and fix gross breakage — blank canvas, missing sprites, console errors.
  The user's eyes are for fidelity and feel, never for catching a broken page.

## 5. Commit

- Commit on the branch. Use Conventional Commits, imperative and capitalized, with no AI attribution.
  Stage only this task's files.
- Do **not** run the review battery yet. Reviews are expensive and pointless if the user rejects the
  work on manual verification — they run in step 8, after the user approves the change and says to
  merge.

## 6. Update the Tracker Before Handoff

Do this **in this branch before asking to merge**:
- If the task came from a ticket: **delete the ticket file in the completing commit** (git history
  is the archive — no done-markers, no moved files). If the task deviated or completed partially,
  rewrite the ticket to exactly the remaining work instead of deleting it.
- If the task came from a legacy `docs/plans/*.md` step: tick the checkbox (the ONLY status marker),
  delete the executed step's prompt block in the same commit, and leave a compact progress note
  (date, branch, what landed, verification, source basis, sign-off status). Keep it short.
- **File new tickets for deferred discoveries**: anything real found during the work or its review
  that is deliberately NOT being done on this branch (an out-of-scope refactor, a perf seam, a
  follow-up the reviewers flagged) becomes `tickets/<area>/<name>.md` — self-contained per
  `tickets/README.md`, committed on this branch. Deferred work named only in the final report is
  work lost.

If no ticket or plan file was involved, state that explicitly in the report. Do not invent one
unless the user asked for it.

## 7. Stop and Report

Report and wait:
- what was done against the requested task,
- tests/build/pipeline/hands-on evidence,
- visual/audio approval URL and checklist if relevant,
- branch and worktree names,
- the tracker update you committed (ticket closed / rewritten, legacy plan note, new deferred
  tickets filed), or "no ticket or plan file involved".

Stop here. If the user requests changes, continue in the same worktree. If the user says to merge,
continue below — the review battery runs then, not before.

## 8. Review and Merge After Explicit Approval

First run the review battery, now that the user has approved the work:
- Run it over `git diff main...HEAD`: spawn the applicable lenses **in parallel, one message**,
  selected exactly as `.claude/commands/audit.md` step 2 defines them (engine / gameplay / code,
  plus a general correctness pass only when no named lens covers the main risk). Pass each the
  exact range.
- Select lenses by what the diff actually touches — do **not** default to the full battery. Most
  steps trip one or two lenses; each extra reviewer is a real token cost and produces noise
  findings outside its lens. State which lenses you skipped and why.
- Triage the findings yourself: re-read the cited code before accepting or dismissing a finding —
  reviewers are wrong in both directions. Fix real in-scope issues, re-run affected gates, and
  commit the fixes. If a fix changes user-visible behavior, report it and wait for a fresh go-ahead
  instead of merging.
- Findings that are real but deliberately deferred (out of scope, a wider refactor, a future-scale
  concern) do not evaporate into the report: file each as a self-contained ticket under
  `tickets/<area>/` on this branch before merging (see step 6).

Then merge:
- Re-read `main`; parallel work may have landed.
- In the worktree, run `git rebase main`. Resolve conflicts there.
- If conflicts or main changes touched this area, re-run the relevant gates and refresh the tracker
  update if the outcome changed. The branch must still include the final tracker update (step 6)
  before merge.
- Fast-forward `main`:
  - If the primary checkout is clean on `main`: `git -C ~/Projects/vikings/vinland merge --ff-only <branch>`.
  - If the primary checkout is on another branch: from the worktree, `git fetch . <branch>:main`.
  - If the primary checkout is dirty on `main`: stop and report. Do not stash or reset it.
- If the pipeline output changed, regenerate primary `content/` from the primary checkout after merge.

## 9. Cleanup

- Stop processes started by this workflow.
- Verify `git merge-base --is-ancestor <branch> main`.
- Exit the worktree session, then remove the worktree and branch:
  `git worktree remove --force ~/Projects/vikings/vinland-<slug>`
  `git branch -d <branch>`
- Final report: merged commits, removed worktree/branch/processes, and any primary `content/`
  regeneration summary.

**Abandoning:** if the user says to drop the work, confirm once, remove the worktree, and delete the
branch with `git branch -D <branch>`.
