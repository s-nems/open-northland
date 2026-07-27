# A blocked assistant errand holds its player's fetch cap forever

**Area:** sim · **Origin:** equipment hand-out investigation, 2026-07-27 · **Priority:** P3

`dispatchAssistantGrants` (`systems/settlers/assistant-grants.ts`) throttles a player to
`ASSISTANT_MAX_IN_FLIGHT` concurrent fetch errands and reserves store stock against the
`acquire`-stage `EquipOrder`s `collectInFlightFetches` counts. An errand that cannot advance still
counts: `planEquipOrder` (`settlers/equip-order.ts`) yields an assistant errand while its settler
carries a load — the "never cost a delivery" rule — and never bounds that yield, so a settler that
stays loaded pins one of the four slots and one reserved unit indefinitely. Four such settlers stop
the player's hand-out entirely, silently.

Only the jobless case is carved out today, and even there the order stays on the settler, so it never
gets a fresh grant either.

Reproduced against `packages/sim/test/settlers/assistant-grants.test.ts`'s fixtures: stamp
`ASSISTANT_MAX_IN_FLIGHT` assistant errands in `acquire`, re-add `Carrying` to those settlers every
tick, grant boots with a stocked pile beside a free settler — the free settler is never dressed. A
3000-tick `magiczny_las` run with gear seeded into each seat's headquarters showed acquire-stage
errands living 600–750 ticks but always resolving, so this is a hole rather than an observed stall.

## Scope

Bound an assistant errand's life so a settler that cannot advance releases both the cap slot and the
reservation. Candidate levers, neither evaluated:

- drop the errand where it currently yields to a load (no new state; the next stride beat
  re-dispatches the settler once its hands are free);
- stamp the issue tick on `EquipOrder` and expire an assistant errand past a deadline (covers every
  blocker, at the cost of a component field).

A player-issued errand keeps today's behaviour either way — it sets the load down and continues.

Coordinate with `finish-the-producer-input-reserve-rule.md`: its first bullet changes the same grant
fetch rung (`nearestStoreHolding`'s accept), so the two should not land blind to each other.

## Verify

- The repro above, inverted into a regression test.
- `packages/sim/test/settlers/assistant-grants.test.ts` stays green (trickle, reservation,
  frozen-jobless).
- `npm test` — no golden moves.
