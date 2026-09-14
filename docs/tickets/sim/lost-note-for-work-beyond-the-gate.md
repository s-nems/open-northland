# Raise the lost note when a builder's site lies beyond every signpost

**Area:** sim · **Focus:** signposts, user messages · **Priority:** P3

`planBuilder` (`packages/sim/src/systems/settlers/drives/economy/builder.ts`) picks its site through the
settler's signpost gate, so a construction site placed outside every circle the builder can reach is
never chosen: the builder idles at home and the player hears nothing. The original plans the walk
regardless and, once its guided pathfinder has failed five times, raises message 3 "is lost. Your scout
may have to erect more signposts" (`an original routine`, reason 1). The cut-off note
(`drives/cut-off.ts`) covers only a settler that itself stands outside its seat's reach, not a site
placed outside it. Verified headlessly: a builder beside its built headquarters with the seat's only
site 200 nodes away, four announce cadences, no `settlerCutOff`, no `settlerGoalUnreachable`.

## Scope

- On the cut-off cadence only, let an idle builder repeat `nearestConstructionSite` with no gate; when
  the ungated pick finds a site the gated one did not, emit `settlerCutOff` for it. The same shape fits
  the gatherer and haul rungs, whose pickers also take the gate, if their cost on the cadence tick stays
  bounded by the idle count.
- Keep the event name and the HUD mapping; name the cadence and the five-failure margin as the
  approximation they are.

## Verify

- `packages/sim/test/signposts/navigation.test.ts`, "the cut-off note": a builder inside the local
  circle of its headquarters with the only site 60 tiles east is announced; the same builder with a
  signpost chain to the site is not.
- `npm test`, goldens unmoved (events sit outside the state hash).
