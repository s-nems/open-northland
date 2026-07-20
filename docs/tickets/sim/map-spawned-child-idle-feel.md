# Give homeless (map-spawned) children an idle stroll anchor

**Area:** sim · **Origin:** map children/soldier-equipment worktree, 2026-07-17 · **Priority:** P3

A map-authored child (`sethuman` baby/child, spawned with `Age` by `createSettler`) has no
`Residence`, and `planChildWander` (`packages/sim/src/systems/family/wander.ts`) only strolls a
child around its **home** — a homeless child stands frozen at its spawn node until it grows up
(at `ADULT_TICKS`, ~2.7 min of ×1 play from a map spawn). Born children are unaffected (birth stamps
`Residence`).

Anchoring the stroll at the child's current position was tried and rejected in the discovering
session: the anchor drifts with every stroll, turning the potter-around-home feel into an unbounded
random walk across the map.

## Scope

- Give the stroll a stable anchor for the homeless case — e.g. remember the spawn node (a
  component stamped at spawn, or reuse another stable per-entity anchor), or adopt the child into a
  nearby home when one exists.
- Keep the RNG draw order stable for the homed path (goldens) and the Owner gating as is.

## Verify

- Unit test: a homeless owned child receives MoveGoals over time but stays within the wander
  radius of its spawn node after many strolls.
- Existing goldens unchanged.
