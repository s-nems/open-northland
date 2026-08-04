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

Apply the touched-file ratchet while implementing. Do not use an existing cleanup ticket to justify
adding a responsibility or narrative section to an overgrown file. Comments added or changed by the
task must carry an irreducible invariant, unit, source basis, approximation, or necessary reason; keep
investigation and commit rationale out of production JSDoc.

For a refactor, keep every hunk tied to one selected hotspot. Judge comments across an extracted source
and all destination modules together; moving prose and adding new module summaries does not improve the
comment budget. Do not add a bespoke source scanner when types, structure, or an existing hygiene rule
can express the boundary.

Run focused tests while working, then the matching gates from `AGENTS.md` and `docs/TESTING.md`.
Pipeline and real-content gates remain local-only requirements when their scope applies.

## 4. Review the diff

Run `code-reviewer` for every code diff, plus the other applicable lenses from `/audit`, before
handoff. The review unit is the full `main...HEAD` diff, not individual commits: cumulative effects
across a branch's commits are part of what is reviewed. Triage findings against the source and fix
agreed blockers and should-fix items. Repeat focused verification after fixes.

Read every touched production module in full, once with comments mentally hidden. Names, types, and
boundaries must still expose its responsibilities and control flow. Require the review to report
`Scope: cohesive | fragmented` plus structure and comment verdicts as `improved`, `neutral`, or
`regressed`; a refactor with fragmented scope or either `regressed` verdict must be fixed before
handoff.

For visual or audio work, name the exact scene, map, and thing to look at or listen for. Do not
self-approve pixels or sound.

## 5. Close the tracker and commit

Before the completing commit:

- delete a finished ticket;
- rewrite a partial ticket to only the remaining work;
- file only verified, valuable deferred findings, after deduping.

For refactor cleanup, report unrelated findings instead of filing follow-up tickets unless the user
requested backlog updates or a material blocker would otherwise be lost.

Re-read the full diff and confirm that source comments do not repeat its commit rationale and that no
added comment carries a calendar date, attribution, revision label, or conversation reference;
grepping the diff's added lines for `20[0-9]{2}-` and the attribution vocabulary is a sufficient
check. Run `git diff --check`, and commit with the repository's Conventional Commit style. The
completing commit must include the final tracker state.

## 6. Serve the branch for verification

Player-visible work is handed off with a running app, not with a request that the user start one.
Purely internal work (perf, docs, sim-internal refactor) says so in one line instead.

`content/` is gitignored, so link it first: `ln -s "$primary_root/content" "$worktree/content"`.
A branch that writes content takes `cp -Rc` instead - the pipeline refuses to write through a link.

`:5173` is the primary checkout's. Take a free port from `5174-5199` (`scripts/dev-ports.sh`) and
start Vite from inside the worktree; a workspace-level `npm run dev` has resolved to the primary
checkout's `packages/app` before:

```bash
cd "$worktree/packages/app" && ./node_modules/.bin/vite --port "$PORT" --strictPort
```

Before sending the URL, prove the listener's cwd is this worktree (`lsof -nP -iTCP:$PORT
-sTCP:LISTEN`) and that `/maps-index` answers 200 - a 404 there means the content link is missing.
Report the port and pid with the link.

## 7. Handoff

Report the branch, commit(s), changed behavior, checks, scope, structure and comment verdicts, review
result, and exact human verification including the live URL. Then stop and wait. Do not merge on
implied approval.

## 8. Refresh and merge after approval

Check `git log --oneline main..<branch>` first: empty means another session already rebased and
landed this work, so verify the behavior survived and go straight to cleanup.

Fetch current `main` and rebase the task branch onto it. Resolve conflicts inside the worktree: at
every conflict stop, list all conflicted files before resolving anything, and never stage blindly
with `git add -A`. After the rebase, audit the result for leftover conflict markers and unintended
deletions. If the effective diff changed, rerun relevant checks and review the changed parts before
merging.

Fast-forward `main` only:

- clean primary checkout on `main`: `git -C "$primary_root" merge --ff-only <branch>`;
- primary checkout on another branch: update `main` without changing that checkout;
- dirty primary checkout on `main`: stop and ask the user to clear or preserve it.

Never reset or overwrite primary changes, and never `git stash` anywhere in this repo - the stash
stack is shared by every worktree, so a concurrent session pops your entry.

## 9. Verify merged main

A branch green in isolation still breaks `main`: a type another worktree landed, a doc link to a
ticket this branch deleted, formatting left by conflict resolution. In the primary checkout, run the
`ci.yml` gates on merged `main` - `npm run check:assets`, `npm run check:docs`, `npm run check`,
`npm run build`, `npm test` - then fix on `main` and commit, or revert the merge. Local runs cover
one OS and CI runs three, so flag golden-hash work as unproven.

## 10. Clean up

Kill the verification server by its recorded pid and confirm the port is free, so it returns to the
pool instead of serving a deleted checkout. Stop other processes started by the workflow. Confirm the
branch is an ancestor of `main`, remove the worktree, then delete the merged branch. Report the merged
commits and cleanup result.

If the user abandons the task, confirm before removing the worktree and force-deleting an unmerged
branch.
