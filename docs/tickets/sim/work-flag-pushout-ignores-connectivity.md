# Keep snapped and displaced work flags on connected ground

**Area:** sim · **Priority:** P3

`nearestWorkFlagPlacement` ranks legal nodes by Manhattan distance without connectivity. A flag pushed
from a new building footprint, or a player click snapped off an obstacle, can therefore cross a narrow
river to a closer but disconnected bank and move its harvest radius away from the worker. The settler
eviction path already uses a connected BFS for the equivalent problem.

## Scope

Choose the nearest legal node reachable from the origin, with a deterministic node-id tie break, for
auto-plant, footprint push-out, and player snap. Keep the search locally bounded for player snapping.
Document this as a project correctness rule; fidelity to the original remains unobserved.

## Verify

A river fixture has a closer node across water and a farther node on the origin bank; every caller picks
the connected node. Run `npm test`, `npm run check`, and `npm run build`; name intentional golden movement.
