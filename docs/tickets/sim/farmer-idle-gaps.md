# Investigate the farmer's recurring multi-minute idle gaps

**Area:** sim · **Origin:** gatherer idle-loop soak, 2026-07-19 · **Priority:** P3

While diagnosing the collector idle loop, the same 26k-tick soak of
`?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal` showed every seat's farmer going
unproductive for long stretches, repeatedly, and recovering on its own. Recorded spans (settler, tick
range): 154/player 4 at 475→4700, 12550→16125 and 20900→24250; 176/player 5 at 400→3600, 4125→7125 and
11600→14725; 110/player 2 at 475→3550 and 7925→11825; 88/player 1 at 8125→11825; 71/player 0 at
600→4025; 132/player 3 at 22325→25850. That is roughly 3,000–4,200 ticks (4–6 minutes of game time at
12 ticks/s) of a seat's only farmer neither running an atomic nor carrying, three or four times per
seat per run.

The measurement is coarse and may be benign: "productive" in that soak meant *a running atomic whose
effect is a harvest, or a carried load*, so a farmer that is ploughing, sowing, watering, walking a long
field circuit, eating, or asleep counts as idle. Crop growth is genuinely slow, so some waiting is the
mechanic working. Nothing here is evidence of a bug yet — it is an unexplained pattern that nobody has
looked at.

Note the gatherer soak no longer surfaces these: it now classifies trades with `harvestCapableJobs`,
which deliberately excludes field-farmed goods (a farmer is bound to its field, not to a flag), so
farmers fall outside that detector entirely. Any investigation here needs its own observation.

## Scope

- Instrument what a farmer is actually doing across one of the recorded gaps — the atomic it runs (if
  any), its `MoveGoal`, whether it is `Stranded`, and the crop stage of its field. `packages/app/soak/`
  is the place to observe it; extend the sampler with a farm-aware productivity signal rather than
  reusing the gatherer one.
- Decide from that whether the gaps are the crop cycle (document as expected and close), a needs/sleep
  interaction, or a real stall in the farming drive (`packages/sim/src/systems/agents/farming/`).
- If it is a stall, pin the fix with a scenario test, not only a soak run.

## Verify

- The instrumented soak explains every gap in the run with a named activity.
- If a defect is found: a `packages/sim/test/agents/` regression that fails without the fix.
