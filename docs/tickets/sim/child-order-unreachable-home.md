# Child order stalls silently when a parent cannot reach the home

**Area:** sim (+ a small app surface) · **Origin:** stuck-workers debugging, 2026-07-16 · **Priority:** P3

`driveChildOrders` (`packages/sim/src/systems/family/children.ts`) walks each parent home with
`enterHome` → `atOrWalk`, but has no failed-route protocol of its own: when the walk fails (the door
enclosed by later construction, a signpost-area mismatch), the planner's stranded recovery
(`systems/agents/ai.ts`, `Stranded`) sheds the dead route on its pace and the family pass re-issues
the identical walk — a paced retry loop. The wife meanwhile waits INSIDE (render hides her) with the
larder fund reserved, indefinitely, and the player sees only a husband standing in a field.

## Scope

- Decide the deactivation rule: treat a repeatedly-unreachable home like the existing `!active`
  preconditions (order persists, settlers released, wife steps out) — e.g. after N shed routes toward
  the home, or by reusing the signpost `navigationLimitFor` check that already suspends the hoard
  drive for an out-of-area home.
- Surface it: the settler/home details panel should say the order is waiting on an unreachable home
  (the `hoard-economy-readability` ticket already collects child-order status captions — extend it
  rather than duplicating).

## Verify

- Headless: a couple whose home door is walled off after the order → both parents released to the
  economy within the deactivation window, food reserve freed, order still standing; unblocking the
  door resumes it.
- `npm test`, goldens unmoved (family fixtures have no failed routes).
