# Stop four sweeps from re-checking state that did not change

**Area:** sim · **Priority:** P2

Four systems re-examine every candidate on a fixed cadence although almost none of them changed. On
`magiczny_las_12_players` with 13 AI seats they cost about 1.4 ms of each late tick together, with
bursts on their cadence ticks. Numbers are from `npm run bench:profile` from the 40k checkpoint
(4,000 ticks, quiet) and the 60k one (2,000 ticks, busy machine); profiled timings are inflated by
the sampler, the counts are exact.

- **Vision restamps every eye.** `visionSystem` (`systems/vision/system.ts`) rebuilds every
  `VISION_CADENCE_TICKS = 5` ticks by running `stampVision` over the full ellipse of every owned eye
  (about 780 persons and 233 buildings at 60k): 1,055 ms at 60k, 80% in `stampVision`, about 2.6 ms per
  rebuild. The p95 of 2.5-2.9 ms in every profile is exactly those rebuild ticks; the quiet maximum is
  8.6 ms (the 97 ms in the busy 60k run did not reproduce). Under the classic fog mode (no fog of
  war) a `VISIBLE` cell never falls back, so an eye that has not reached a new cell writes nothing,
  yet a standing building re-walks about 560 cells per rebuild.
- **Field reclaim floods from every crop.** `fieldReclaimSystem`
  (`systems/economy/field-reclaim.ts`) re-probes each of the ~628 crops every 60 ticks with
  `probeRoute`, an undirected breadth-first flood from a stance cell until it touches the farm door
  (cap 2,048). A healthy field, the common case, pays the whole disc between stance and door: 2,205 ms
  at 40k (0.55 ms/tick, 86% in `probeRoute`/`stepsInto`), a window median of 0.37-0.48 ms from the
  first window on, and single ticks up to 5 ms quiet when the id stagger lines up many crops.
- **Technology discovery sweeps the population twice a tick.** `technologySystem`
  (`systems/progression/discoveries.ts`) runs as both `technologyAfterMissions` and
  `technologyAfterWork`. Each run sorts every `Person + Settler` and builds a `DiscoveryInput` per
  settler (experience sum, content lookup, owner) only to find it equal to the memo: 1,248 ms at 40k
  (0.31 ms/tick; `canonicalById` 21%, `contentIndex` 20%), 5x growth from the first window. The needs
  drain writes `Settler` every tick, so the component's value generation cannot tell which settlers
  gained experience, a job or a lesson.
- **Livestock capture tests every scout against every animal.** `livestockCaptureSystem`
  (`systems/livestock/capture.ts`) runs `claimableBy` plus two `entityNode` resolutions for every
  scout x `Livestock` pair every tick. It is the heaviest early: 0.36 ms window median with 206
  livestock at tick 10000, 0.07 ms once most are claimed. That is per-pair work, against the
  project's scale rule.

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
- Livestock capture: bucket the livestock by node once per tick and probe each scout's
  `LIVESTOCK_CAPTURE_RANGE` neighbourhood. The claim order stays ascending scout id.

The capture docs already name that the original claims on each new position a scout reaches rather
than every tick. Switching to that rule is a behaviour change (an animal that walks up to a standing
scout is no longer claimed) and needs the user's decision; it is not required for the cost cut.

## Verify

- Headless: the existing vision, field-reclaim, discovery and capture tests pass unchanged; add a
  fixture per sweep that counts the work done for an unchanged world (stamps, visited nodes,
  evaluated settlers, pair tests) and asserts it no longer scales with the candidate count.
- Session and checkpoint recipe: the twelve-player run in `docs/DEVELOPMENT.md` (Measuring
  performance); a checkpoint family from this session's 60k run exists in the worktree's `bench-out/`.
  `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map`, then
  `npm run bench:compare`: `vision` p95, `fieldReclaim`, `technologyAfterWork` and
  `technologyAfterMissions` medians fall. The state hash must stay identical.
- `npm test`, `npm run check`, `npm run build`.
