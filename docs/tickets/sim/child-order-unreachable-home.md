# Release a child order whose parent cannot reach the home

**Area:** sim · **Priority:** P3

`driveChildOrders` (`packages/sim/src/systems/family/children.ts`) walks each parent home with
`enterHome` → `atOrWalk`, but has no failed-route protocol of its own: when the walk fails (the door
enclosed by later construction, a signpost-area mismatch), the planner's stranded recovery
(`systems/agents/ai.ts`, `Stranded`) sheds the dead route on its pace and the family pass re-issues
the identical walk — a paced retry loop. The wife meanwhile waits INSIDE (render hides her) with the
larder fund reserved, indefinitely, and the player sees only a husband standing in a field.

## Scope

- Treat a repeatedly unreachable home like the existing `!active` preconditions: keep the order,
  release both settlers and the food reservation, and retry on a deterministic cooldown. Use a named
  retry budget or the existing signpost navigation limit; either is an approximation and must be
  recorded as such.

## Verify

- Headless: a couple whose home door is walled off after the order → both parents released to the
  economy within the deactivation window, food reserve freed, order still standing; unblocking the
  door resumes it.
- `npm test`, goldens unmoved (family fixtures have no failed routes).
