# Give the player a way to un-post a worker

**Area:** app · **Priority:** P2

Staffing is now entirely the player's decision, but only in one direction: `assignWorker` posts a
settler to a building and nothing takes it back off. To free a worker the player must either post it
somewhere else or route through the profession picker's "Cywil" row, which also throws away its
trade. Posting a baker to a foundation is the sharpest case - the wait is the whole point of the
feature, and it lasts the entire build with no visible undo.

`unassignHouse` is the model: the residents window offers the inverse of `assignHouse` on the same
selection (`view/unit-controls/index.ts`).

## Scope

An `unassignWorker` command that drops the settler's `JobAssignment` (keeping its trade), plus the
control that issues it - the workers window's per-worker action, matching how a resident is evicted.
A settler posted to a construction site must be releasable the same way as one in a finished
building.

Out of scope: any automatic re-employment. A released settler stays trade-ful and unposted until the
player says otherwise.

One class already has an implicit release: a walk order un-posts a tower garrison, because standing
the watch has no other end (`systems/settlers/drives/tower-post.ts`). The explicit control must land on
the same semantics - drop the binding, keep the trade - so the two do not diverge.

Related gap worth folding in: there is no settlement-wide view of trade-ful but unposted settlers, and
a razed workplace now releases its crew into exactly that state. Today they can only be found by
clicking each one, so the release control and a way to see who is waiting for work belong together.

## Verify

A sim case per arm (posted → released keeps its trade; a released carrier stops hauling), an app
case for the control's enablement, and a human pass on the workers window.
