# One settlement's bakery still sits at its shelf cap

**Area:** packages/sim · **Origin:** fix/food-export-conversion, 2026-07-20 · **Priority:** P3

After the craftsman haul fix, a 20 000-tick `magiczny_las` soak (seeds/seats as
`?map=magiczny_las&ai=0,1,2,3,4,5`) drains five of six bakeries — per-seat bread 0/0/6/0/5/**19**.
Seat 5 stays at 19 of its 20-loaf cap. The matched control (same commit, haul rung disabled) reads
17/19/19/17/17/**19**, so seat 5 is at 19 with AND without the fix: it is a separate phenomenon, not a
regression, and the fix simply does not reach it.

## Scope

- Find what distinguishes seat 5 from the five that drain. Candidates worth measuring before changing
  anything: no reachable sink inside the crew's signpost area, a headquarters already full of
  `food_simple`, a bakery whose craftsman is permanently seated (`workSeatCount` never zero because
  flour keeps trickling in), or a crew stuck in the gossip fence (`ai.ts`, the `Chat` skip above the
  economy rungs).
- Instrument rather than infer: trace the seat-5 bakery's planner decisions over the LAST few hundred
  ticks. Counters aggregated across the whole run mix the healthy early phase with the stalled end state
  and produced three wrong diagnoses on the originating branch.

## Verify

Re-run the soak and compare per-seat bread against the numbers above. A fix should move seat 5 without
regressing the other five.
