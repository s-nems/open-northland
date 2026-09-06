# Prove the sim hashes identically across JavaScript engines

**Area:** sim, app · **Focus:** determinism · **Priority:** P2

Multiplayer will be deterministic lockstep: every client runs the full simulation and applies the
same commands on the same ticks, so any client whose state differs by one bit from the others is out
of the game. The desktop shell (Electron) and Node share V8, but the web shell also runs on
JavaScriptCore (Safari) and SpiderMonkey (Firefox). Every determinism proof in the repository runs in
one Node process: `packages/sim/test/core/fuzz-determinism.test.ts`, the golden hashes, and the
scene checks. Nothing has ever compared a hash computed in a browser with one computed in Node.

The sim is designed for this: `core/fixed.ts` keeps state as integer-valued doubles, the hygiene test
in `packages/sim/test/core/hygiene.test.ts` bans transcendental math, wall-clock reads, and
locale-dependent APIs, and `fx.isqrt` integer-corrects its `Math.sqrt` seed. IEEE 754 pins the basic
operations, so a mismatch is a bug in a specific place rather than a property of the platform. The
known hazards the hygiene test cannot see are: a sort comparator that is not a total order (engines
use different sort algorithms; stability is guaranteed, the result under an inconsistent comparator
is not), the `**` operator with a fractional exponent, and the "local float calculation" allowance in
`packages/sim/AGENTS.md`.

Desktop has priority. Chromium must match Node; WebKit and Firefox are measured and reported, and a
mismatch there narrows the web client to Chromium rather than blocking the chain.

## Scope

- A Playwright-driven check that boots the app in a browser, runs a fixed workload, and reads the
  hash sequence. No new seam is needed: the debug handle installed by
  `packages/app/src/view/runtime/debug-handle.ts` exposes the live `sim` on `window.__opennorthland`,
  so `page.evaluate` can call `sim.run(n)` and `sim.hashState()` on the
  `HASH_TRACE_EVERY_TICKS` cadence from `packages/app/src/diag/session.ts`. Boot through the dev
  server or the built site with `content/` present, the way the screenshot harness in
  `docs/DEVELOPMENT.md` does. Do not add a browser-only sim path: the workload is the same scene and
  real-map world the headless harness already builds.
- Two workloads: a registered scene golden, and 2000 ticks of `magiczny_las` with six AI seats under
  `npm run test:content` conditions (skipped cleanly without `content/`).
- A Node run of the same workloads is the reference. Compare per-cadence hashes, not only the final
  one, so a divergence names its first tick.
- Report the result per engine. Chromium is a gate; WebKit and Firefox are informative (they need
  `npx playwright install`) and their result is recorded in the completing commit message.
- On a Chromium mismatch, localize with `HashTrace.divergedFrom` and `localizeDivergence`, fix the
  cause in the sim, and extend the hygiene test when the cause is a scannable pattern.
- Document the check and how to run it in `docs/TESTING.md`.
- Non-goals: no network code, no changes to the hash algorithm, no new sim entries.

## Verify

- Node and Chromium produce identical hash sequences for both workloads.
- The WebKit and Firefox results are recorded; a mismatch there is filed as a bounded sim ticket
  naming the first diverging tick, not fixed in this ticket unless the cause is a one-line fix.
- `npm run check`, `npm run build`, `npm test`, and `npm run test:content` where content exists.
