# Retire builders' obsolete approaches when their site finishes

**Area:** sim · **Focus:** construction, settler errands · **Priority:** P2

A builder still approaching a site can report that it is lost after another builder completes
an upgrade. Construction approaches use the current tier's perimeter; the completed tier can
cover that work cell. `finishBuilding` leaves the approaching builder's `SiteAssignment` and
`MoveGoal` intact. Footprint route invalidation then requests the same obsolete destination,
and the travelling early-out in `releaseStaleIntent` postpones normal builder planning until
that route fails and the stranded retry expires. There is no construction work left at the site.

Verified with generated Viking (tribe 1) `home_level_01` → `home_level_02` footprints and
synthetic economy data: seed 1, `grassNodeMap(128,40)`, upgrade site at node (90,20), one wood
already in its bill, and an approaching builder at (10,20). Put a second builder at the first
builder's selected perimeter stance. Ordinary build atomics finish the upgrade while the first
is travelling. The new body covers its captured goal, but its approach remains active and raises
one `settlerLost` within 1,000 ticks. Source basis: current simulation behavior and generated
footprint data. This differs from a home errand retaining an old entrance: the builder's task
itself has ended.

## Scope

- Release completed construction work for builders still approaching it, so their normal planner
  can select current work before an obsolete stance becomes a failed-route notification.
- Reconcile outstanding material deliveries to a completed site without losing carried goods or
  retaining dead reservations. Preserve player pins and workplace bindings according to their
  existing rules; do not cancel unrelated orders or conversations merely because an assignment exists.
- Keep safe stopping during a live step and the existing routing budget. Do not suppress genuine
  failures to sites that still need work.

## Verify

- Add the two-builder ordinary-completion reproduction to construction integration tests: the
  approaching builder retires its old task without `Stranded`, a newly recorded unreachable
  work cell, or `settlerLost`, and can begin another available site.
- Cover completion while a supplier carries an outstanding bill unit, a builder mid-step, and a
  control where the original site remains unfinished. Check goods and reservations are conserved.
- Run the standard gates in `docs/TESTING.md`.
