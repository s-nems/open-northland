# Fail or reroute a walk whose goal interaction node is statically blocked

**Area:** sim (nav/movement) · **Origin:** review-battery test work on fix/regression-fixes, 2026-07-16 · **Priority:** P3

A building without a `door` footprint offset resolves its interaction node to its own anchor
(`footprint/interaction.ts` `interactionNode`), and a footprint that blocks its anchor cell makes
that goal permanently unwalkable: the walker keeps its `MoveGoal` forever, pathfinding never
produces a route or a stand-in, and the unit stalls silently in place (observed while writing the
pinned-builder routing test — `delivery.cases.ts` documents the artifact). Real extracted buildings
all carry doors, so live content never hits this; synthetic/hand-authored content can.

## Scope

Pick one: (a) `interactionNode`'s no-door fallback prefers a walkable footprint-adjacent cell over a
self-blocked anchor (the `nearestFreeNeighbour` rule `positionedInteractionCell` already applies to
non-buildings), or (b) the routing goal stand-in rule treats a statically-blocked goal like a
crowded one and surrounds it. Either way a walk that can never complete should resolve to the
nearest legal stand, not a silent permanent stall. Keep winners canonical; goldens must not move unless the
change is intentional and named.

## Verify

Unit test: a door-less self-blocking building on a full-size map receives a delivery (the scenario
the pinned-builder test had to soften); `npm test` otherwise green.
