---
description: Complete one task in an isolated worktree, verify it, then fast-forward when authorized.
argument-hint: <task or docs/tickets/<area>/<name>.md>
---

# Worktree workflow

Execute `$ARGUMENTS`; ask for a task if empty. Read root and touched-package contracts. User
instructions override this default isolation workflow, including authorization to work on `main`.
Do not edit the primary checkout before integration. Preserve existing work; never use the shared
Git stash or overwrite another session's changes.

## Create or resume

Derive the primary checkout from Git, inspect status and worktrees, then choose a short task branch:

```bash
git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
primary_root=$(dirname "$git_common_dir")
GIT_LFS_SKIP_SMUDGE=1 git worktree add -b <prefix>/<slug> "$(dirname "$primary_root")/on-<slug>" main
```

If the branch or worktree exists, inspect it before resuming. Run `npm ci` in a new worktree.
Copy ignored `AGENTS.override.md` and `CLAUDE.local.md` from the primary checkout when present,
without overwriting existing files. Use its `.env` by absolute path only in the process that needs it.
Fetch LFS objects only for sources the task opens; see [DEVELOPMENT.md](../../docs/DEVELOPMENT.md#git-lfs).

Verify ticket claims against code and allowed evidence before implementing. Read callers and tests;
state the bounded change, verification path and any human acceptance needed.

## Implement, verify and review

Follow root code/comment rules. Each change should serve the requested outcome. Use focused tests
while editing, then [TESTING.md](../../docs/TESTING.md#choosing-the-required-checks). Before integration,
worktree runs may scope Vitest to changed packages and their dependents; the full suite runs once on
integrated `main`. Real-content and pipeline gates still apply. Benchmark only performance claims.

Review the full `main...HEAD` diff, including uncommitted changes before committing. Apply the relevant
[/audit](audit.md) checks and root review policy. Fix verified defects, including scope or structure
regressions, and rerun affected checks.

Delete completed tickets or reduce partial tickets to remaining work. Follow the
[ticket admission rules](../../docs/tickets/README.md) for deferred findings; do not create a cleanup
backlog by default. Run `git diff --check`, inspect the final diff and commit with Conventional Commit
style. The completing commit includes the tracker changes.

## Prepare human verification

For player-visible work, leave a verified server running. Internal changes need no preview server.
Use primary content through a symlink only for read-only tasks; content-writing tasks need an
independent copy. Compile the worktree before serving because package imports resolve to `dist/`.

`:5173` belongs to the primary checkout. Find a free port in `5174–5199` with `scripts/dev-ports.sh`:

```bash
cd "$worktree/packages/app"
npm run dev -- --port "$PORT" --strictPort
```

Prove the listener's cwd belongs to this worktree with `lsof -nP -iTCP:$PORT -sTCP:LISTEN`; for
real-content entries verify `/maps-index.json` returns 200. Open the actual scene and inspect console
errors and the changed behavior. A responding server alone is not verification. Report URL, port,
pid and any checks still needing a human. Asset handoffs follow
[PIPELINE.md](../../docs/art/PIPELINE.md), including candidate gallery and real-map review.

Report commits, changed behavior, checks and remaining risks. If integration is not already
authorized, ask for approval of this concrete result; otherwise continue.

## Integrate and clean up

1. Check `git log --oneline main..<branch>`. If empty, verify the task is already present and clean up.
2. Fetch the target remote when configured. Update a clean local `main` by fast-forward when possible;
   if local and remote target histories diverged, report it rather than rewriting unrelated commits.
3. Rebase the task onto current `main`. Inspect all conflict paths before resolving, stage only intended
   files, and review the resulting diff. Rerun affected checks if the effective change differs.
4. Recheck `main`; rebase again if it advanced. In a clean primary checkout on `main`, integrate with
   `git merge --ff-only <branch>`. If it is dirty or on another branch, preserve it and arrange a clean
   integration checkout; do not silently move a checked-out branch underneath another session.
5. On integrated `main`, run the repository checks and full suite from `TESTING.md`. A scoped branch
   run does not cover concurrent integration. Fix failures before reporting completion.
6. Stop task processes by recorded pid and verify released ports. Confirm the task branch is an
   ancestor of `main`, remove the worktree and delete the merged branch. Keep a requested review
   server alive until the user finishes review.

Report integrated commits, verification, cleanup and any new tickets with their concrete purpose.
Ask before discarding an abandoned, unmerged worktree.
