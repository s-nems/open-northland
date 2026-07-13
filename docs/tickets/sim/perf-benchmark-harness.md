# Build a headless sim benchmark harness reporting ms/tick per system

**Area:** sim · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P3

AGENTS.md golden rule 6 ("RTS scale is a budget: per-tick sim cost scales with active work, never
entities squared") has no measuring harness. Verified 2026-07-13: no `*.bench.*` files exist
anywhere in `packages/` or `tools/`; the only perf instrumentation is the runtime overlay
(`packages/app/src/view/perf-overlay.ts`), which needs a browser and human eyeballs. Budget
regressions (an accidental O(n²) in a per-tick system) are currently only caught if someone notices
the game feeling slow.

Source basis: none needed — this is self-consistency tooling, not a mechanic.

## Scope

1. A headless, deterministic benchmark scenario: seeded sim on a synthetic map with thousands of
   settlers doing real work (jobs, hauling, combat — reuse existing scenario/fixture builders where
   they exist rather than inventing a parallel world-builder). Content must be synthetic — no
   copyrighted map data in the repo.
2. Per-system timing: measure ms/tick per system across N ticks (warmup + measured window), report
   median/p95 per system plus total tick cost, machine-readable (JSON) + human-readable table.
   Timing instrumentation must live outside sim purity — wrap the system loop from the harness (or
   inject a timer through the existing system-runner seam) rather than putting `performance.now()`
   inside `packages/sim` (the hygiene test rejects nondeterministic globals there).
3. Runnable on demand: an npm script (e.g. `npm run bench:sim`), excluded from the default
   `npm test` run so CI time is unaffected; runnable *in* CI manually/optionally.
4. A CI regression gate (thresholds, baseline tracking) is **optional/deferred** — if worth doing,
   file it as a follow-up ticket; absolute thresholds are machine-dependent, so the follow-up should
   consider relative (per-system share / scaling-curve) checks instead.

## Verify

- Two runs with the same seed simulate identical state (hash-check) — the benchmark itself is
  deterministic even though wall-times vary.
- The report visibly attributes cost per system on a local run; numbers are plausible against the
  perf overlay's live readings.
- `npm test` unaffected (bench excluded); `npm run check`, `npm run build`.
