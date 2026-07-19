# Consumer self-service production at shared utility buildings (well, hive)

**Area:** sim · **Origin:** user clarification on the AI build-placement branch 2026-07-19 · **Priority:** P2

## The intended mechanic (source: user 2026-07-19)

The well (`work_well_00`) and beehive (`work_hive_00`) are **not** staffed producers. Nobody is
permanently posted to them. Instead any worker who needs the good produces it for themselves on
demand: a baker short of water walks to the well, "turns the crank" (stands at the operate spot),
produces one water, and carries it back to their own recipe. The hive works the same way for honey.
There is no dedicated well/hive worker animation yet, so a worker simply standing at the operate
node is the accepted visual.

## Current engine gap

Production advances only while a posted OPERATOR stands on the workplace's node. For a carrier-only
building, `operatorJobsOf` (`systems/stores/workplace.ts`) makes the lone carrier the operator, so
`presentOperators` returns `DESERTED` when nobody is posted and the well's/hive's input-less recipe
(180 ticks → 1 water / 1 honey) never runs. The AI leaves both unstaffed (user rule 2026-07-18,
`systems/ai-player/workforce.ts` step 3 + `CARRIER_STAFFED_BUILDING_IDS`), which matches the intended
self-service model — but because that model is unimplemented, the AI's `work_bakery_00/01` never
receives water (recipe input, good `water`) and the bread/cake chain stalls. A human player hits the
same wall unless they manually park a settler on the well.

## Scope

A consumer-driven production drive for shared utility producers: when a producer worker (or its
bound supplier/carrier) is short a recipe input that some reachable utility building produces from no
inputs, route the worker to that utility's operate node, run the utility's recipe there in place, and
return the output to the consuming workplace (carry it back, or deposit into the utility's stock for
the ordinary fetch path to pick up). Keep it data-driven (no hardcoded well/hive ids — the signal is
"an input-less producer of the needed good"), deterministic (canonical target pick, seeded RNG only),
and within the per-tick budget. The operate step reuses the existing produce atomic; the missing
crank animation is a named approximation (worker stands at the node).

Once this lands, drop the `work_well_00`/`work_hive_00` note from the AI staffing comment and confirm
they still need no permanent staffing.

## Verify

- A headless AI-seat scenario that runs long enough to build the mill + well + bakery and asserts the
  seat eventually holds baked bread (the assertion the gameplay review asked for, impossible until
  this exists).
- A sim unit test: an input-less utility producer yields its good to a consumer with no permanently
  posted operator; the consumer's recipe then advances.
- `npm test`, `npm run check`, `npm run build`; `npm run test:content` for the real bakery/well chain.
