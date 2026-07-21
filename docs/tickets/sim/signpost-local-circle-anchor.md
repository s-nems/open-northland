# Anchor the signpost local circle to something stationary

**Area:** sim (signposts) · **Priority:** P2
**Needs user:** observe what anchors the local navigation area in the running original.

`navigationLimitFor` (`packages/sim/src/systems/signposts/network.ts`) centres the settler's LOCAL
circle (`LOCAL_NAV_RADIUS_NODES`) on its CURRENT position, re-evaluated per query. Consequence (named
in the code): the confinement is trivially bypassed by repeated in-circle hops — any goal ≤ 24 nodes
away is always allowed, so a player can march a civilian anywhere in 12-tile steps, and an autonomous
worker re-centres its circle every completed job and can drift arbitrarily far off the network.

The original's anchor for "the area a settler may act in without signposts" is not decoded.

## Scope

Observe and implement a stationary anchor. Plausible probes include:

- the settler's bound workplace / home when it has one, its spawn point otherwise;
- the last in-network node the settler stood on (a "leash" that follows legal travel but not drift);
- keep the moving circle but shrink it, relying on signposts for everything beyond a few tiles.

Order a unit repeatedly just past its area's rim in the original and name any remaining approximation.
Keep default-off behaviour byte-identical.

Source basis: observed original behaviour is the goal; today's moving circle is a named approximation
(the user-specified rule set) whose bypass was flagged by the gameplay review.

## Verify

Update `packages/sim/test/signposts/navigation.test.ts` so repeated short hops cannot escape the local
area, while the signpost scene's collector still reaches its chained tree. Run `npm test`, `npm run
check`, and `npm run build`.
