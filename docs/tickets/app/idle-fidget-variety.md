# Interleave one-shot idle fidgets with the base wait

**Area:** app · **Priority:** P3

A standing body loops only its `gfxanimmode 1` base wait. The source authors more: per wait bobseq,
several one-shot fidget programs on the wait-action ladder (actions 2..6 - stretch, look around,
scratch) beside the looping base wait, and the original interleaves them - mostly base wait, an
occasional fidget, back to base wait. `gfxWaitProgramsBySeq` currently collapses that ladder to the
single winning program, so the fidget lists are extracted but never played.

Implement the interleave render-side:

- Widen the wait join to keep the whole ladder per seq (base wait + the one-shot fidget programs),
  not just the winner.
- Schedule fidgets in the presentation layer. Deterministic per entity - derive from `item.ref` and
  the tick (the existing `IDLE_PHASE_STEP` desync shows the pattern); no `Math.random`, no sim state.
- A fidget plays once, then the clock returns to the base-wait loop. Bodies with no fidget programs
  (animals keep only the mode-1 row today) behave exactly as now.
- The interleave cadence (how often a fidget fires) is unobserved - pick a rate, name it an
  approximation.

## Scope

- `packages/app/src/content/ir/joins.ts` (wait join shape), the settler binding, and the sprite-pool
  frame selection. No sim changes, no schema changes (the programs are already in the IR).

## Verify

- Unit: the scheduler is a pure function of (ref, tick) - same inputs, same fidget choice.
- Human pass: a standing crowd mostly breathes, individuals occasionally stretch or glance, no two
  neighbours in lockstep.
