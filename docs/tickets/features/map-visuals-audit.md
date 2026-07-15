# Final map-visuals audit + acceptance panorama (the closing gate)

**Area:** app + docs · **Origin:** map-visual-fidelity plan reconciliation, 2026-07-12 ·
**Blocked by:** [authored-building-variants](authored-building-variants.md),
[wall-runs](wall-runs.md), [map-authored-animals](map-authored-animals.md),
[wave-phase-audit](../render/wave-phase-audit.md), [water-fx-and-shore](water-fx-and-shore.md),
[rocky-ground-recompare](rocky-ground-recompare.md) · **Priority:** P2

The sign-off gate for "a decoded map is visually indistinguishable from the original". Baseline at
time of filing: the resolve-rate warning in `packages/app/src/content/objects.ts` reported
~776/43477 placements with no resolvable graphics.

## Scope

- Rank + resolve the unresolved placement types: missing extractor bindings (mirror the nearest
  extractor + wire into `resolveGraphicsBindings`) vs legitimate fx placeholders — document the
  remainder.
- Verify the vegetation species/palette mix visually (mechanism landed via `nodesByGfxIndex`;
  examples: OrangeTree 01 vs 02, yew 01 vs 02 — same bmd, different palettes → the yellow/green
  canopy mix).
- Build a 7-frame aligned original-vs-ours panorama over mosty-1..7 from local captures as the
  acceptance artifact.

## Verify

- Gates green; the panorama gallery is the artifact — **the owner signs off the whole look**.
