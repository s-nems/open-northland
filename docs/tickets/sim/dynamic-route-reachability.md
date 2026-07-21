# Make economy target selection route-aware under dynamic blockers

**Area:** sim · **Priority:** P2

Target picks reject blocked goal cells and briefly memoize failed goals, but they cannot detect a clear
cell enclosed by resource/building footprints. On a 40k-tick `magiczny_las` soak, an iron collector
cycled permanently among enclosed nodes: only 12 of 113 eligible-in-radius deposits were routable, far
beyond the eight-entry failed-goal memo. Increasing that FIFO only postpones the same failure.

## Scope

- Add a bounded route-reachability signal for economy picks, maintained from blocker changes or computed
  once per planning context. Do not run A* per candidate.
- Apply it first to harvest/resource picks, then to other target families only where the same failure is
  reproduced.
- Release any `SupplyRun` reservation while its route is parked if measurement confirms that it blocks a
  substitute worker.

## Verify

The 40k gatherer soak reports no permanently stalled collector and fewer failed route requests. Focused
tests cover a clear-but-enclosed nearest node with a farther reachable alternative. Run normal gates.
