# Pin work-cell behavior for deposits covered by buildings

**Area:** sim · **Priority:** P3
**Needs user:** observe whether the original permits mining a covered deposit from an exposed side.

Sandbox clay includes its anchor in the full-state work area, while extracted clay/mud use adjacent
full-state cells. `resourceWorkCell` also filters resource blockers but not building blockers. The same
house-over-deposit case is therefore skipped in sandbox content but can be side-mined, or falsely skipped
despite another open work cell, with real content.

## Scope

After observing the original, make work-cell selection apply one rule to every candidate and every
consumer. Add an anchor-excluded fixture matching extracted content. Player feedback for ignored deposits
is out of scope unless the observation shows the original provides it.

## Verify

A focused test pins covered, partially exposed, and fully exposed deposits. Run `npm test`; name any
intentional pick/golden movement.
