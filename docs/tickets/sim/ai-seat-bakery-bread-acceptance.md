# AI-seat acceptance: an autonomous seat bakes bread through the well self-service chain

**Area:** sim (acceptance) · **Origin:** follow-up from utility-self-service-production, 2026-07-19 · **Priority:** P3

## Why

Consumer self-service at shared utilities (well/hive) now works: a bakery baker or carrier draws its own
water from an unstaffed well and carries it back, and the bakery's recipe advances. This is proven
deterministically by `packages/sim/test/economy/utility-self-service.test.ts` (a lone baker + unstaffed
well produces bread) plus the MODE 1/MODE 2 planner cases.

What is NOT yet asserted end-to-end is the gameplay review's original ask: a **strategic AI seat**, given a
real map, autonomously builds mill + well + bakery from its opening build order, staffs the bakery, and
eventually holds baked bread — the whole loop under the real AI, not a hand-placed fixture.

## Scope

Extend the real-content AI harness (`packages/app/test/content/ai-map-scenario.test.ts` is the closest
existing shape — a decoded map, `setPlayerAi`, `sim.run(ticks)`) with a long-run case that:

- builds far enough for the seat to own a built well + bakery (and mill for flour), and
- asserts the seat eventually holds `bread` (a `goodProduced` bread event, or bread in an owned store).

This is a heavy run (construction + gathering + staffing take thousands of ticks) and is real-content
gated (skipped in CI, like the existing scenario), so budget the tick count and keep it `describe.runIf`
guarded. If the build order or population pacing makes the full chain impractically slow, a mid-weight
alternative is a hand-seeded seat that already owns the built mill/well/bakery and only needs the economy
to run — closer to the unit test but exercising the real AI staffing path (`workforce.ts`) rather than a
bound-settler fixture.

## Verify

- The new case asserts owned bread after the run; `npm test` (or `npm run test:content` for the
  real-content path) stays green.
