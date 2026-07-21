---
description: Execute one requested task in an isolated worktree, verify it, wait for approval, then fast-forward merge.
argument-hint: <task or docs/tickets/<area>/<name>.md>
---

# Worktree workflow

Execute `$ARGUMENTS` and nothing broader. If it is empty, ask for a task. Read `AGENTS.md` and the
contracts for packages you touch.

Never edit the primary checkout before merge. Never merge without explicit user approval.

## 1. Create the worktree

Confirm the primary checkout has no operation in progress. Preserve any user changes there.

Derive paths from Git:

```bash
git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
primary_root=$(dirname "$git_common_dir")
```

Choose a short slug and an honest branch prefix such as `feat/`, `fix/`, `refactor/`, or `docs/`.
Create a sibling worktree from current `main` and run `npm ci` inside it. If the branch or worktree
already exists, inspect it before deciding whether this is a resume or a collision.

## 2. Verify the task

If the task is a ticket, read it and confirm its claims against current code and allowed source
evidence. Correct stale research in the ticket rather than implementing a false premise.

Inspect callers, tests, dependency direction, and existing patterns. State a short implementation
plan and any required human verification. Do not pull adjacent ticket work into the branch.

## 3. Implement and test

Make the smallest complete change. Add the lowest useful regression test. Keep the worktree usable
after each coherent patch.

Run focused tests while working, then the matching gates from `AGENTS.md` and `docs/TESTING.md`.
Pipeline and real-content gates remain local-only requirements when their scope applies.

## 4. Review the diff

Run the applicable lenses from `/audit` before handoff. Triage findings against the source and fix
agreed blockers and should-fix items. Repeat focused verification after fixes.

For visual or audio work, prepare the exact scene, URL, screenshot, or listening path for the user.
Do not self-approve pixels or sound.

## 5. Close the tracker and commit

Before the completing commit:

- delete a finished ticket;
- rewrite a partial ticket to only the remaining work;
- file only verified, valuable deferred findings, after deduping.

Re-read the full diff, run `git diff --check`, and commit with the repository's Conventional Commit
style. The completing commit must include the final tracker state.

## 6. Handoff

Report the branch, commit(s), changed behavior, checks, review result, and exact human verification.
Then stop and wait. Do not merge on implied approval.

## 7. Refresh and merge after approval

Fetch current `main` and rebase the task branch onto it. Resolve conflicts inside the worktree. If the
effective diff changed, rerun relevant checks and review the changed parts before merging.

Fast-forward `main` only:

- clean primary checkout on `main`: `git -C "$primary_root" merge --ff-only <branch>`;
- primary checkout on another branch: update `main` without changing that checkout;
- dirty primary checkout on `main`: stop and ask the user to clear or preserve it.

Never stash, reset, or overwrite primary changes.

## 8. Clean up

Stop processes started by the workflow. Confirm the branch is an ancestor of `main`, remove the
worktree, then delete the merged branch. Report the merged commits and cleanup result.

If the user abandons the task, confirm before removing the worktree and force-deleting an unmerged
branch.
