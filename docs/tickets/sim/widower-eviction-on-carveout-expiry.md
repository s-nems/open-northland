# Release a widower's home when his last child stops growing

**Area:** sim · **Priority:** P2

A widower keeps his family slot while raising a minor. When that child grows up or dies, neither the
growth nor cleanup path re-evaluates the father, so he keeps `Residence` and a dead-spouse marriage edge
indefinitely. This recreates the slot leak the wife's-death path already prevents for a lone man.

## Scope

Share the existing rule “male widower with no growing child vacates” across spouse death, child
graduation, and child death. Trigger it from those rare events; do not add a whole-world per-tick scan.
Preserve the current rule that a widow keeps her home.

## Verify

Tests cover both carve-out expiry paths and the widow counterexample, asserting `Residence` removal and
the freed `familiesOf(home)` slot. Run `npm test`, `npm run check`, and `npm run build`.
