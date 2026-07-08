---
description: Execute a user-specified Vinland task in an isolated git worktree, verify it, update the source plan, wait for approval, then fast-forward merge.
argument-hint: <task, plan step, or docs/plans/<file>.md step>
---

You are running the **primary Vinland workflow**. The user writes plans under `docs/plans/` and
manually invokes `/worktree` for one plan step at a time. Execute the requested scope faithfully in
an isolated git worktree, report for manual verification, and merge only after the user explicitly
says to merge.

The task from the invocation: **$ARGUMENTS**. If it is empty, ask for the task before doing anything.

Hard rules:
- Read `AGENTS.md` before editing. Load package-local `AGENTS.md` only for packages you touch.
- The user's plan is authoritative. Do not substitute your own next step or pull adjacent work.
- Never touch the primary checkout (`~/Projects/vikings/vinland`) until the final merge step.
- Never merge without explicit user approval.
- Before merge, update the relevant plan file so progress survives across worktree sessions.

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

- If `$ARGUMENTS` names a plan file or step, open that plan and identify exactly one step to execute.
- Re-check factual claims against source files before coding. Plans are research notes, not ground
  truth.
- If the step is already done, impossible, or contradicted by code/source reality, stop at the
  smallest safe point and report the deviation. The user decides the new scope.

## 3. Do the Work

- Keep edits scoped to the requested step.
- Mechanics and extracted data must name their source basis in the changed code, tests, plan progress
  note, or commit message: extracted `.ini`/`.cif` data, OpenVikings format oracle, or observation of
  the running original. If behavior is approximated, say what is approximated and why.
- Do not create new running ledgers for lessons, tech debt, fidelity, or roadmap state. Durable rules
  belong in `AGENTS.md` or package-local `AGENTS.md`; planned future work belongs in `docs/plans/`.

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

## 5. Commit and Review

- Commit on the branch. Use Conventional Commits, imperative and capitalized, with no AI attribution.
  Stage only this task's files.
- Run the review battery over `git diff main...HEAD`: spawn the applicable lenses **in parallel,
  one message**, selected exactly as `.claude/commands/audit.md` step 2 defines them (determinism /
  perf / fidelity / architecture / code-quality, plus a general correctness pass only when no named
  lens covers the main risk). Pass each the exact range.
- Triage the findings yourself: re-read the cited code before accepting or dismissing a finding —
  reviewers are wrong in both directions. Fix real in-scope issues, re-run affected gates, and
  commit the fixes.

## 6. Update the Plan Before Handoff

If this task came from `docs/plans/*.md`, update that plan **in this branch before asking to merge**:
- Tick the completed checkbox, or mark it blocked/deviated with a one-line reason. The checkbox is
  the ONLY status marker — no separate `[DONE]` tags.
- Delete the executed step's prompt block in the same commit — the ticked checkbox and the progress
  note carry the state; git history keeps the prompt.
- Add or update a compact progress note with: date, branch, what landed, verification, source basis,
  and visual/audio sign-off status if relevant.
- Keep the note short. Do not paste transcripts or long implementation narratives.

If no plan file was involved, state that explicitly in the report. Do not invent one unless the user
asked for it.

## 7. Stop and Report

Report and wait:
- what was done against the requested plan step,
- tests/build/pipeline/hands-on evidence,
- visual/audio approval URL and checklist if relevant,
- review findings and how they were handled,
- branch and worktree names,
- the exact plan progress update you committed, or "no plan file involved".

Stop here. If the user requests changes, continue in the same worktree. If the user says to merge,
continue below.

## 8. Merge After Explicit Approval

- Re-read `main`; parallel work may have landed.
- In the worktree, run `git rebase main`. Resolve conflicts there.
- If conflicts or main changes touched this area, re-run the relevant gates and refresh the plan note
  if the outcome changed. The branch must still include the final plan update before merge.
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
