# Decide whether the sim bench gets a regression gate (and on what metric)

**Area:** sim (tooling) · **Origin:** carried out of the completed `sim/perf-benchmark-harness.md`,
2026-07-17 · **Priority:** P3

`npm run bench:sim` measures per-system ms/tick but **asserts nothing about cost** — a budget
regression is caught only if a human reads the table and notices. The harness ticket deliberately
deferred a gate rather than guessing at one; this is that decision, kept alive so it does not
evaporate with the parent.

**Decide first whether it is worth it at all.** A gate nobody trusts gets muted, and this one has a
real failure mode: absolute ms are machine-dependent (a laptop, a CI runner, and a loaded dev box
disagree by multiples), so a threshold in milliseconds would flap. Closing this ticket with "not
worth it, the human table is enough" is a legitimate outcome — record the reasoning in the commit.

If it is worth it, the metric matters more than the plumbing. Candidates, roughly in order of
promise:

- **Scaling curve** — assert the *shape*, not the value: run the bench at 1×/2×/4× population and
  fail when a system's cost grows materially faster than the population. This is the only candidate
  that tests golden rule 6 directly, and it is machine-independent. It needs the population/map-area
  confound sorted out first (`docs/tickets/sim/ai-planner-scale-curve.md` item 1).
- **Per-system share** — the report's `sharePct` is already scale-invariant; a gate could pin "no
  system exceeds X% of the tick". Cheap, but today's baseline (`ai` at ~97%) means the threshold
  would encode the very defect that ticket is about — so this waits on it.
- **Relative-to-baseline ms** — a committed baseline JSON per machine class. Simplest to write,
  worst to live with (whose machine is the baseline?). Probably the wrong answer; listed to be
  explicitly rejected.

Whatever is chosen must stay **out of the default `npm test`** — the bench takes ~1 minute at its
defaults and needs a quiet machine, so it belongs in an explicit mode (the `test:content` pattern:
`scripts/*.mjs` guard + runner) or an optional CI job, never a merge gate on a shared runner.

## Verify

The gate fails on a deliberately regressed system (prove it catches something — e.g. add a temporary
O(n²) loop to a cheap system and watch it fire) and passes on a clean tree across at least two
machines. `npm test` unaffected; `npm run check`, `npm run build`.

## Source basis

None needed — self-consistency tooling, not a mechanic.
