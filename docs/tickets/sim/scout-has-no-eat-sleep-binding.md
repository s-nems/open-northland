# The scout has no eat/sleep animation binding in the sim, but does in the render

**Area:** sim · **Origin:** needs-pacing worktree, 2026-07-20 · **Priority:** P3

The viking tribe binds atomic 10 (eat) and 8 (sleep) for jobs 3, 4, 5, 6, 31 and 34 — **not for job
27, the scout**. Verified against generated `content/ir.json`: the scout's only `atomicBindings` row
is `{jobType: 27, atomicId: 43, animation: "viking_scout_build_guide"}`.

So when a scout eats, `atomicDuration` finds no binding and silently falls back to
`DEFAULT_ATOMIC_DURATION = 4` (`systems/readviews/animations.ts`). Its meal is 4 ticks where a
civilist's is 50 — a third of a second on screen. The same applies to its sleep.

The render does **not** have this gap: `packages/app/src/content/settler-gfx/character-specs.ts`
gives the `scout` spec `logicJob: 6`, so it borrows the civilist's eat/sleep clips. The two halves
therefore disagree about whether the scout can eat at all, and the sim's side degrades through a
silent default rather than a named decision.

Pick one and make it explicit:

- **Route unbound jobs through the civilist clip** the way the render already does — the scout is the
  same generic man body, and `jobtypes.ini` gives the scout the civilist atomic set with nothing
  forbidden. This is the likelier reading of the original.
- **Or keep the fallback** but name it: a job with no binding for a need atomic should resolve to a
  stated stand-in, not to the "nothing resolved" stub that also covers genuine data corruption.

Worth checking whether other jobs have the same hole before choosing — the fix should be a rule, not
a scout special case.

**Source basis:** `DataCnmd/tribetypes12/tribetypes.ini` `setatomic` rows (extracted into
`ir.json` `tribes[].atomicBindings`); `jobtypes.ini` for the scout's allowed atomic set.

## Verify

- `npm test`; a duration change moves goldens for any fixture with a scout — name the mechanic.
- `npm run test:content` — assert the chosen rule against the served IR rather than a fixture.
