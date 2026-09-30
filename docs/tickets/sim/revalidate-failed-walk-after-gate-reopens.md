# Revalidate a pending failed walk after its gate reopens

**Area:** sim · **Focus:** route recovery, palisades · **Priority:** P2

An autonomous settler can announce it is lost after a gate has already reopened and restored its
route. Opening a gate updates the physical blocker and region caches, but leaves a failed
`PathRequest` and its `Stranded` wait intact. At the retry deadline, `releaseStaleIntent`
(`systems/settlers/planner/replan.ts`) records the goal in `UnreachableGoals` and calls
`markLostWay` without checking whether the earlier failure still applies.

Verified on a synthetic 16×16 grass node map: a horizontal wall at y=8 contains a five-node closed
gate centred at (8,8), with an autonomous owned woodcutter at (8,2) seeking (8,14). The initial
request correctly fails, and one simulation step adds `Stranded`. Open the gate through
`setPalisadeGate` before the retry deadline. An independent `findPath` immediately finds a route
under the current dynamic overlay. Nevertheless, within the next 150 simulation steps a
`settlerLost` event is emitted and the goal is recorded as unreachable while that route remains open.

Source basis: current code and synthetic reproduction. This concerns announcing an obsolete
failure during the pending recovery window. The documented bounded retention of an already
confirmed failed-goal memo is a separate policy.

## Scope

- When relevant topology changes during a stranded wait, requeue or revalidate the failed walk
  through the normal routing budget before turning that old failure into a lost notification.
- Cover gate opening and removal of blocking structures. Do not add unbudgeted searches to each
  waiting settler, or discard a genuine failure merely because an unrelated obstacle changed.
- Keep an unchanged blocked destination on the existing bounded retry and notification path.

## Verify

- Add a full-schedule regression under `packages/sim/test/systems/palisade-routes.test.ts`: fail an
  autonomous walk, reopen before `STRANDED_RETRY_TICKS`, then reach the goal without a lost event
  or a newly recorded unreachable goal.
- Repeat with wall demolition; keep a control with the gate closed and another with an unrelated
  topology edit. Check warmed and cold blocker/region views agree after the opening.
- Run the standard gates in `docs/TESTING.md`.
