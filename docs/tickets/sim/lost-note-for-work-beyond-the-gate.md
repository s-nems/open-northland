# Raise the lost note when a builder's site lies beyond every signpost

**Area:** sim · **Focus:** signposts, user messages · **Priority:** P3

`planBuilder` (`packages/sim/src/systems/settlers/drives/economy/builder.ts`) picks its site through the
settler's signpost gate, so a construction site placed beyond every range the builder can reach is
never chosen: the builder idles at home and the player hears nothing. The original plans the walk
regardless and, once its guided pathfinder has failed five times, raises message 3 "is lost. Your scout
may have to erect more signposts". The cut-off mark
(`drives/cut-off.ts`, `LostWay` with `cutOff`) covers only a settler that itself stands outside its
seat's reach, not a site placed outside it. Verified headlessly: a builder beside its built
headquarters with the seat's only site 200 nodes away, four check cadences, no `settlerLost`.

## Scope

- On the cut-off check cadence only, let an idle builder repeat `nearestBuilderSite` with no
  gate; when the ungated pick finds a site the gated one did not, mark it lost (`markCutOff`) and
  lift the mark the same way `reconcileCutOff` does once the gated pick finds it. The same shape fits the
  gatherer and haul rungs, whose pickers also take the gate, if their cost on the cadence tick stays
  bounded by the idle count.
- Keep the event and the HUD mapping; name the cadence and the five-failure margin as the
  approximation they are.

## Verify

- `packages/sim/test/signposts/navigation.test.ts`, "the cut-off mark": a builder inside the walk
  range of its headquarters with the only site 60 tiles east is marked; the same builder with a
  signpost chain to the site is not.
- `npm test`; the save golden moves only if the marker's placement in a fixture changes.
