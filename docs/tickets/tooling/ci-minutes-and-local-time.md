# Cut CI minutes and local agent turnaround: LFS, lean workflows, fast vitest

**Area:** tooling · **Priority:** P1

Working plan for one supervised session: the orchestrator (Fable) runs phases in the order below and
delegates the marked steps to Opus 5 subagents. Work happens directly on `main` (owner's decision, no
other worktrees exist); history is rewritten once in phase 3. Delete this ticket when every phase has
landed; `vitest-module-import-cost.md` is superseded by phase 4a and is deleted with it.

## Measured problem (2026-09-15, runs 34984410704 CI and 34984433109 Release)

GitHub bills macOS x10 and Windows x2; the private repo has 2000 free minutes a month.

| CI job | wall | billed |
| --- | --- | --- |
| test (macos-latest) | 8.7 min | ~90 |
| test (windows-latest) | 23.9 min | ~48 |
| test (ubuntu-latest) | 11.1 min | 12 |
| lint, build, art | 2 + 2 + 4 min | ~10 |
| CI total per push or PR (dependabot included) | | ~160 |

| Release job | wall | billed |
| --- | --- | --- |
| installers (macos, two dmgs) | 7.1 min | ~80 |
| installers (windows) | 7.8 min | ~16 |
| content (checkout 6 + build:content 9 + test:content 6) | 22 min | 23 |
| guard, relay-image, image, installers (ubuntu), publish | | ~18 |
| Release total | | ~137 |

Root causes, each verified:

1. Every checkout fetches 2.4 GB. `docs/art` is 2.3 GB: 1.5 GB of `.blend/.glb/.fbx/.gz` and
   ~1 GB PNG, of which recipes reference 161 MB (93 files). Nothing in CI reads the geometry.
   Fetch costs 1.5 to 6 min per job; locally `git worktree add` copies 2.4 GB in 15 s. `.git` is
   5.7 GB because git stores every binary revision whole.
2. Vitest isolates modules per file: Ubuntu suite 552 s wall of which tests 125 s and import 349 s.
   Locally `--no-isolate` takes the no-content suite from 66 s to 18 s; 5 tests in 4 files then fail:
   `packages/app/test/optional-texture.test.ts`, `packages/render/test/backing-resolution-lifetime.test.ts`,
   `packages/sim/test/economy/production-dormancy.test.ts`,
   `packages/sim/test/settlers/target-candidates-lazy.test.ts` (module-level spies, mock hoisting,
   Pixi touching `document`).
3. `scripts/build-content.mjs` removes `content/` before the pipeline, so the music stage (7 of the
   9 pipeline minutes, already incremental via its manifest) never keeps a render. Same locally.
4. `packages/app/test/content` (46 files) runs inside plain `npm test` whenever `content/` exists;
   `relay-map-parity.test.ts` alone is 166 s locally and 227 of 366 s of the release `test:content`.
5. The release builds a mac x64 dmg the owner does not use, runs `npm run build` four times, and
   installers for Linux that are rarely needed.

Cheap and fine: `npm ci` 3 to 10 s, typecheck 3 s (TS 7), biome 1.6 s, app build seconds.

## Owner decisions

- Test matrix: Ubuntu only. Windows on a `workflow_dispatch` checkbox of the same CI workflow.
- Default release: Windows (portable + NSIS x64) and mac arm64. Linux AppImage and mac x64 only on
  `workflow_dispatch` checkboxes.
- `docs/art` retained sources stay in the repo, moved to Git LFS. Boundary: what `art build`, tests,
  or scripts read stays a plain blob; what only a human opens (geometry, model exports, projections,
  candidate boards) is LFS. Dead variant directories (no recipe and no README names them as the
  current source) are deleted without asking; doubtful ones stay and are listed.
- History may be rewritten (`git lfs migrate import --everything`) and force-pushed now.
- One Release dispatch at the end to verify, accepting that the minute budget may cut it short.
- Test-value audit is a report for the owner, no deletion by agents.

## Scope

### Phase 1: lean `ci.yml` (agent, on `main`, commit only, orchestrator pushes)

- `on`: push to main, pull_request, `workflow_dispatch` with boolean input `windows` (default false).
- `concurrency: { group: ci-<ref>, cancel-in-progress: true }`.
- Jobs: `checks` (check:assets, check:docs, npm ci, check, build), `test` (ubuntu, `npm test`),
  `test-windows` (`if: inputs.windows`, windows-latest, `npm test`), `art` (unchanged steps; skip on
  `pull_request`). Keep the SHA-pinned action versions, Node 22, npm cache, minimal comments.
- Update the prose that claims three OSes: `docs/TESTING.md` "Standard gates", `.claude/commands/worktree.md`
  step 9, anything else `grep -rn "macOS" docs .claude` finds about CI.

### Phase 2: `docs/art` classification (agent, read-only, runs parallel to phase 1)

Deliver: (a) the set of `docs/art` files read by recipes (`asset.json`, `recipe.json`, `assets.json`,
`delivery.json`, `approvals.json`, `lighting.json`), by `tools/art-pipeline`, by tests, and by
`scripts/` (`own-art-sources.json`, `check-repository-assets.mjs`), with sizes; (b) the remaining
files grouped by directory pattern so `.gitattributes` can name them (expected: `**/source/geometry/`,
`**/model/`, `**/projected/`, `**/head/`, `*.blend`, `*.glb`, `*.fbx`, `*.gz`); (c) dead variant
directories by the owner's criterion with sizes (known candidates `docs/art/buildings/house-2/source/compact-c`
131 MB, `.../iso-c` 52 MB; check every `source/*` and `characters/appearances/*`); (d) how
`check-repository-assets.mjs` derives source roots, so the LFS rule can be added there.

### Phase 3: LFS migration and history rewrite (orchestrator)

1. Delete dead variants from phase 2 (one commit, list them in the message).
2. `.gitattributes`: `filter=lfs diff=lfs merge=lfs -text` for the phase 2 patterns. Add the rule to
   `check:assets`: a file a recipe reads must be a plain blob (never an LFS pointer), and a
   `docs/art` file over 1 MB that no recipe reads must match an LFS pattern. Commit.
3. Delete stale refs `refs/remotes/x/main` and `refs/remotes/local/main` (their remotes are gone).
4. `git lfs migrate import --everything --include=<patterns>`; then `git reflog expire --expire=now --all`
   and `git gc --prune=now`. Expect `.git` to drop from 5.7 GB to well under 1 GB.
5. Verify before pushing: `git lfs ls-files | wc -l`; `git status` clean; in a fresh
   `GIT_LFS_SKIP_SMUDGE=1 git clone` of the local repo run `npm ci`, `npm run check:assets`,
   `npm run art -- build all`, `npm run art -- validate all`, `npm test` (content absent): all green
   without a single LFS object.
6. Push: `git push --force origin main`, `git push --force --tags` (the eleven `build-*` tags are
   rewritten too; the GitHub prereleases keep their names). Delete the remote `dependabot/*` branches;
   dependabot recreates them on the new history. The pre-push hook uploads ~2 to 3 GB of LFS objects;
   uploads are not metered.
7. Time a fresh `GIT_LFS_SKIP_SMUDGE=1 git clone` from GitHub and record it here for the report.

### Phase 4: parallel agents in worktrees off the new `main`

4a. Vitest. `isolate: false` on both projects; fix the four files (or give them a tiny isolated
    project with the reason recorded); move `packages/app/test/content/**` out of the default projects
    into a `content` project that only `npm run test:content` runs (it already targets that path);
    cap workers (`maxWorkers`) so parallel worktrees do not oversubscribe; update `docs/TESTING.md` and
    delete the superseded `vitest-module-import-cost.md` ticket.
4b. Release. `workflow_dispatch` inputs `linux` and `macX64` (default false) gate the AppImage job and
    the x64 dmg; `electron-builder.yml` mac target arm64 by default, x64 added through the CLI arch
    flag when the input is set; build the web app once in an ubuntu job and pass `packages/app/dist`
    as an artifact to `image` and every `installers` job; `actions/cache` for `content/music` keyed on
    the archive SHA and the music stage source; `build-content.mjs` keeps `content/music` across
    rebuilds so the stage's own manifest check applies (locally too); release `test:content` skips
    `relay-map-parity` (an env gate such as `ON_RELAY_PARITY=off`, documented in `docs/TESTING.md`).
4c. Local workflow. `.claude/commands/worktree.md` step 1: `GIT_LFS_SKIP_SMUDGE=1 git worktree add`,
    and `git lfs pull -I docs/art/<package>` when a task needs sources; `docs/DEVELOPMENT.md`: content
    regeneration keeps music and takes `--zip` from the local archive; `docs/art/PIPELINE.md`
    "Source retention": the LFS boundary and the pull-per-package habit.

### Phase 5: verify on GitHub (orchestrator)

Push, watch the lean CI run, then dispatch one Release with default inputs. Record billed minutes of
both runs in the final report.

### Phase 6: test-value audit (agent, report only)

Input: the per-file timings measured in this session (top files: `relay-map-parity` 166 s,
`map-mission-acceptance` 17 s, `map-transfer` 12 s, `chest-contents` 11 s, `map-invariants` 11 s,
`ai-player-military` 7 s, `scenes/battle` 7 s, `shadow-packing` 6 s, `ai-player-modules` 6 s,
`lockstep-parity` 6 s; 692 of 741 core files under 0.5 s). Output: a list of tests to delete or merge
with a one-line reason each (duplicate coverage, asserts the implementation rather than a contract,
long runtime for a claim a cheaper test already proves), grouped by package, for the owner's approval.
No deletion in this phase.

## Verify

- CI on push: only `checks`, `test`, `art`; Windows appears only after a dispatch with the box ticked.
- Release default run produces `*-portable.exe`, `*-setup.exe`, `*-arm64.dmg` and the web image; a
  dispatch with `linux` and `macX64` adds the AppImage and the x64 dmg.
- `npm run check:assets` fails on a recipe input that is an LFS pointer and on a large unreferenced
  `docs/art` file outside the LFS patterns.
- `npm test` without content: green, under 30 s locally; `npm run test:content` still runs the 46
  content files; golden hashes unchanged.
- Fresh `GIT_LFS_SKIP_SMUDGE=1` clone builds the art catalog and passes `npm test` without LFS.
- Second `npm run build:content` on an unchanged archive reports the music tracks as kept.
