# Stop three sweeps from re-checking state that did not change

**Area:** sim · **Priority:** P2

Three systems re-examine every candidate on a fixed cadence although almost none of them changed. On
`magiczny_las_12_players` with 13 AI seats, the trust-clean `npm run bench:profile` from the 40k
checkpoint (4,000 ticks; profiled timings are inflated by the sampler) puts them at about 1.3 ms of
each tick together, with bursts on their cadence ticks; the busy-machine profile from 60k (2,000
ticks) shows the same shape (absolute ms suspect). The counts are exact.

- **Vision restamps every eye.** `visionSystem` (`systems/vision/system.ts`) rebuilds every
  `VISION_CADENCE_TICKS = 5` ticks by running `stampVision` over the full ellipse of every owned eye
  (about 780 persons and 233 buildings at 60k): 1,993 ms at 40k, 76% in `stampVision`, about 2.5 ms
  per rebuild. The p95 of 2.5 ms and the maximum of 8.6 ms at 40k are those rebuild ticks. Under the
  classic fog mode (no fog of war) a `VISIBLE` cell never falls back, so an eye that has not reached a
  new cell writes nothing, yet a standing building re-walks about 560 cells per rebuild.
- **Field reclaim floods from every crop.** `fieldReclaimSystem`
  (`systems/economy/field-reclaim.ts`) re-probes each of the ~628 crops every 60 ticks with
  `probeRoute`, an undirected breadth-first flood from a stance cell until it touches the farm door
  (cap 2,048). A healthy field, the common case, pays the whole disc between stance and door: 2,205 ms
  at 40k (0.55 ms/tick, 86% in `probeRoute`/`stepsInto`), and single ticks up to 5 ms when the id
  stagger lines up many crops.
- **Technology discovery sweeps the population twice a tick.** `technologySystem`
  (`systems/progression/discoveries.ts`) runs as both `technologyAfterMissions` and
  `technologyAfterWork`. Each run sorts every `Person + Settler` and builds a `DiscoveryInput` per
  settler (experience sum, content lookup, owner) only to find it equal to the memo: 1,248 ms at 40k
  (0.31 ms/tick; `canonicalById` 21%, `contentIndex` 20%). The needs drain writes `Settler` every
  tick, so the component's value generation cannot tell which settlers gained experience, a job or a
  lesson.

Expected gain: up to about 1.3 ms of the 18.7 ms tick at 40k (field reclaim 0.55, vision 0.5
amortized, technology 0.31), and the 2.5 ms vision p95.

## Scope

Pure optimisations, one commit per sweep, each with an identical state hash:

- Vision: skip the stamp of an eye whose cell and radius are unchanged since its last stamp while no
  downgrade pass ran for its group (the fog-of-war modes keep restamping, or keep a persistent layer
  for stationary eyes if they are measured too).
- Field reclaim: replace the undirected flood with a search directed at the door under the same
  visit cap. Only `exhausted` strands a field, and a sealed pocket within the cap is exhausted by
  both searches; `reached` and `giveup` both keep it, so every keep-or-strand verdict is unchanged.
- Technology: re-evaluate only settlers whose job, owner, experience or learned lists were written
  since their last evaluation (a derived dirty set fed from those write sites, rebuilt in full after a
  restore), plus everyone when the permission key changes.

## Verify

- Headless: the existing vision, field-reclaim and discovery tests pass unchanged; add a fixture per
  sweep that counts the work done for an unchanged world (stamps, visited nodes, evaluated settlers)
  and asserts it no longer scales with the candidate count.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: `vision` p95, `fieldReclaim`,
  `technologyAfterWork` and `technologyAfterMissions` medians fall. The state hash must stay
  identical.
- `npm test`, `npm run check`, `npm run build`.
