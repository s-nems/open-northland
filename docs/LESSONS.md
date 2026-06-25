# Lessons — the loop's hard-won memory

One-line, **commit-grounded** gotchas that a fresh-context iteration would otherwise re-learn. This
is the compounding half of the work loop: when a step surfaces a non-obvious, generalizable trap
(a determinism pitfall, a "green tests but broke at the real entry point" slip), it lands here so
the next iteration inherits it.

**Scope.** This file is *not* rules (those graduate to [`CLAUDE.md`](../CLAUDE.md) /
[`packages/sim/CLAUDE.md`](../packages/sim/CLAUDE.md)), *not* the plan
([`ROADMAP.md`](ROADMAP.md)), and *not* deferred reworks ([`TECH-DEBT.md`](TECH-DEBT.md)).

**Contract.**
- Format: `- [<sha>] <lesson> — <fix/why> (<area>)`. Ground every entry in the commit that taught it.
- Keep it lean: most steps add nothing. Add a line only when re-learning it would cost real time.
- Curation (a `/reflect` duty): promote a recurring / rule-worthy lesson into `CLAUDE.md` and prune
  it here; drop entries the code has made obsolete. This is the anti-bloat valve.

## Lessons

- [fec4ded] Integer atomic durations: `progress = ONE/duration` truncates, so an odd duration never
  reaches `ONE` and the atomic hangs forever — count an integer `elapsed` to the exact
  `elapsed >= duration`; keep `progress` only as a derived display value. (sim/atomic)
- [6a4d20a] Path completion removes `PathFollow` in pass 1, so a `Velocity`-bearing entity
  double-moves on its arrival tick unless pass 2 skips path-handled ids — record handled ids in a
  membership Set and skip them. (sim/movement)
- [ca10cf4] raw-TS strip-types can't resolve the sim's `.js` import specifiers, so the test fixture
  isn't in `dist/` — hands-on sim smoke runs go through a throwaway `vitest` spec on the real
  `Simulation.step()` schedule, not compiled `dist/`. (tooling)
- [bfe2491] A weapon `type` id isn't globally unique (105 weapons collapse to 19 typeIds — per-tribe
  re-use), so `indexById` silently drops records; key by `(tribeType, typeId)`. (data/extract)
- [9a497c9] `npm run build` (tsc) only compiles `src/**` — test files aren't in the project graph and
  vitest doesn't typecheck, so adding a required `SystemContext` field leaves stale test `ctx` literals
  type-broken yet green; grep `SystemContext = {` across `test/` when the context shape changes. (sim/tooling)
- [4ef956f] A roadmap "extract X from file Y" promise can name a field that file Y doesn't have —
  `landscapetypes.ini` has no per-type movement weight (only `maximumValency` + placement flags), so
  the long-carried "real per-type walk-cost field, pending extraction" was chasing a non-existent
  source. Before implementing a "pending extraction" step, grep the actual source file's key set
  first; correct the roadmap when the field isn't there rather than inventing a mapping. (data/roadmap)
- [79e02a7] Importing a `test/` file (e.g. a fixture) from production `src/` drags it into that
  package's `tsc --build` graph, which emits `.js`/`.d.ts` *in-place next to the .ts* — stray
  untracked artifacts `biome check` then lints and fails on. Keep dev/demo fixtures self-contained in
  `src/` (a tiny synthetic copy), don't reach across into another package's `test/`. (tooling/render)
- [fa70452] A `sim` mechanic with data-pinned *parameters* (atomic durations, job gates, stock caps)
  is NOT thereby `faithful` — its *behavior* (planner/loop shape) has no oracle (OpenVikings' tick is
  a stub). Classify those rows `approximated` with "calibration-by-observation pending"; reserve
  `faithful` for when both axes are pinned. Over-claiming faithful is the blind spot FIDELITY.md
  exists to catch. (docs/fidelity)
