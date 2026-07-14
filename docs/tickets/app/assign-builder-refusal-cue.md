# Give a "can't" cue when right-clicking a foundation with no builder selected

**Area:** app (input/feedback) · **Origin:** bmd-build-progress review, 2026-07-14 · **Priority:** P3

Right-clicking an under-construction building routes every selected settler to the `assignBuilder`
command (`packages/app/src/view/unit-controls/orders.ts`). The sim gates it to the builder trade
(`packages/sim/src/systems/orders/work.ts` — `jobAtomics(...).has(BUILD_HOUSE_ATOMIC_ID)`), so a
selection containing **no builders** produces a logged no-op: the units neither move, assign, nor
visibly refuse. Mixed selections work (the builders assign, the rest no-op), and a builder-only pin is
correct — the gap is only the all-non-builder case, which gives the player zero feedback.

## Scope

- When no selected unit qualifies for the foundation (no builder among them), surface a "can't" cue —
  a cursor flash / denied-click sound — instead of a silent no-op. Mirror whatever refusal feedback
  other invalid right-click targets already use (check `unit-controls/orders.ts` for an existing
  pattern before adding one).
- Keep the mixed-selection behavior: qualifying builders still assign; only a wholly-unqualified
  gesture refuses.

## Verify

- Headless: assert the command list is empty for an all-non-builder selection on a foundation.
- Human: right-click a foundation with only a farmer selected → a visible/audible "can't", no
  silent nothing.
