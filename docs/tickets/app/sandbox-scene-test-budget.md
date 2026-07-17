# The sandbox scene test is flaky under parallel load (60s budget, ~58–116s runtime)

**Area:** app · **Origin:** review battery on refactor/render-cleanup, 2026-07-17 · **Priority:** P3

`packages/app/test/scenes.test.ts > sandbox` carries a 60s timeout and sits right on it. Measured
2026-07-17:

- in isolation on the branch: the whole file is 18/18 in ~116s, and `sandbox` passes;
- under a 3-package parallel run (`vitest run packages/render packages/app packages/audio`): `sandbox`
  intermittently times out at 60s — it failed once and passed on an immediate re-run of the identical
  tree;
- a reviewer measuring against the merge-base worktree got ~58s there vs ~67s on the branch, i.e. both
  within noise of the budget, on opposite sides of it.

So the test's pass/fail depends on machine load, not on the code. That is a broken tripwire: it cries
wolf on unrelated branches (it did on this one, and two reviewers had to spend effort proving it was
not a regression), which trains the next agent to wave a real failure through.

**Not attributable to the render cleanup**: that branch touches neither `packages/app/src/scenes` nor
this test, its only sim change is one re-export, and its `?shot` capture is byte-identical to the
merge-base. Verify that claim rather than trusting it.

## Scope

Find out where the ~110s goes before changing the budget — a bigger number is the wrong fix if the
scene got slow by accident. Profile per-system over `dist/` with a throwaway node script (never add
`performance.now` to `src` — the sim hygiene scan fails the build).

Then either:
- cut the cost (the likely candidate is the scene's tick count or entity population — check what the
  headless checks actually need), or
- if the runtime is legitimate, raise the per-test timeout to a value with real headroom (2–3× the
  measured isolated time) and say in a comment why the scene is slow.

While there: `scenes.test.ts` runs every registered scene in one file, so its total grows with each new
scene. Consider whether the per-scene cases should be their own files so one slow scene cannot starve
the rest.

## Verify

`npm test` green three runs in a row, including under a full parallel run. State the measured per-scene
times in the commit so the next person has a baseline.
