# Re-compare the rocky-hill layout vs the original after the mesh rebuild (survey)

**Area:** render/docs · **Origin:** map-visual-fidelity plan reconciliation, 2026-07-12 · **Priority:** P3

The owner reported the rocky-hill layout differing from the original. Since then the terrain mesh
was rebuilt on the original tessellation with `emt` transition overlays, and the elevation divisor
was corrected — the difference may be fully explained. Pattern names per triangle are verbatim
data, so any residual must be shading/overlay/object-level, not the pattern choice.

## Scope

- Re-compare columns ~150–178 of mosty-5 against our render using aligned local crops and a
  difference heatmap.
- Fix only what the evidence pins; **deferring with numbers is a legitimate outcome**.

## Verify

- Side-by-side for any change — **user's eyes**; the report carries the measured residuals either
  way.
