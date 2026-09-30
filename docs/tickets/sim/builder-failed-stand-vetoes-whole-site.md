# Try another construction stand before abandoning the site

**Area:** sim · **Focus:** construction targeting and failed-route recovery · **Priority:** P2

An automatic builder excludes an entire construction site when its nearest perimeter stand is in
`UnreachableGoals`, even when another legal perimeter stand remains reachable. The planner leaves the
builder idle while the fully supplied foundation still needs labor. The failed stand remains excluded
for the 360-tick memo lifetime; movement or another target may change the pick earlier.

`unreachableSiteStand` in `settlers/targets/reachability.ts` chooses one stand through
`constructionWorkCell` and turns that stand's veto into a site veto. `planBuilder` applies it to task
selection and staging. `claimWorkCell` also chooses from the perimeter without filtering the worker's
failed goals, so filtering only site discovery would leave the actual walk free to pick the failed
stand again.

Verified with a focused planner probe using the existing construction fixture: an all-grass 20×10
half-cell map, a HOUSE foundation at visual position (5,2), its complete bill of two stone and one wood,
and an unassigned builder at (1,2). The first planner pass selects a stand. Clear the route and record
only that selected node through `noteUnreachableGoal`, representing the planner's completed failed-route
recovery. Other legal perimeter nodes exist on the same connected grass terrain. The next planner pass
creates `IdleStand` and no `MoveGoal`, rather than walking to an alternative. Positive control: place
the same builder on another legal perimeter node while retaining the memo; the next planner pass
starts a `construct` atomic. This
reproduction seeds prior failure state; it does not establish how frequently real maps produce that
failure.

## Scope

- Resolve a usable construction stand for this worker before rejecting a site. Apply its failed-goal
  veto, navigation area and reachability consistently to discovery and the actual claimed stand.
- Preserve perimeter occupancy and deterministic claim ordering. Bound pins retain their existing
  site commitment; this task changes how an automatic builder finds an alternative stand.
- Reject or wait at a site when every permitted stand is unavailable, and retry as existing recovery
  rules allow.

## Verify

- Add the supplied-site fixture above: after the nearest stand is memoized, the automatic builder
  chooses another allowed stand and adds labor without waiting for memo expiry.
- Cover all stands vetoed, memo expiry, and two builders claiming distinct permitted stands.
- Include a multi-system case where a route actually fails and recovery chooses another stand at
  the same supplied site. Keep same-seed results identical.
- Run focused construction, spacing and failed-route recovery tests, then the standard sim checks.
