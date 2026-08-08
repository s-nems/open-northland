# Cut repeated module evaluation in the Vitest run

**Area:** tooling · **Priority:** P3

A full `npm test` spends far more worker time loading modules than running tests. Measured over the
496-file suite: `import 549s, transform 107s` against `tests 142s`. Vitest's default `isolate: true`
gives every test file a fresh module registry, so each of ~470 files re-evaluates its slice of
`packages/sim` (377 source files) and everything below it.

The lever is measurable in isolation. On `packages/sim` alone, `vitest run packages/sim --no-isolate`
finished in 29.8s wall / 27s CPU against 47.3s / 91s with isolation, with `import` falling from 319s to
145s: a 3.4x CPU reduction.

The cost compounds because concurrent worktrees are normal here and each Vitest run sizes its worker
pool to the whole machine independently, so N suites request N times the machine's cores.

## Scope

- Establish whether each Vitest project is correct without module isolation and turn it off where it
  is; a project that needs a fresh registry per file keeps isolation and records why.
- Cap the worker pool so concurrent worktree suites do not each claim the whole machine.

## Verify

- `npm test` green, with wall and CPU time before and after on the same machine, and the load average
  recorded beside each side: a contended box voids the comparison.
- Golden hashes unchanged.
