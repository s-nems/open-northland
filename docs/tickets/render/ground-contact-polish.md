# Trial stronger ground contact for buildings and large props

**Area:** render · **Focus:** visual polish · **Priority:** P3

The graphics-polish branch improves cast shadows and building sampling. A separate, bounded visual
trial should evaluate whether local contact shading and terrain transitions make buildings and large
props feel more grounded. This is an artistic experiment, not a confirmed defect: existing sprites
may already contain painted contact shading that an extra layer would double.

## Scope

- Start with one finished building on grass and bare soil. Inspect its existing painted base and
  shadow before choosing a subtle contact-darkening or ground-transition treatment.
- Compare a small foundation-edge treatment (local dirt, worn ground or grass transition) with the
  current image. Keep it local to the actual footprint, not the rectangular sprite bounds.
- Preserve doors, character scale, picking, navigation, terrain data and construction behavior.
  Use the existing lighting direction; avoid stacking a second full cast shadow.
- Keep the trial switchable for A/B review. Extend to large props only if the building trial is
  visually accepted; author any per-asset placement through content bindings rather than id checks.
- Bound rendering and retained resources; avoid per-object filters or map-wide per-frame work.

## Verify

- Compare the same camera on a playable map at normal zoom, the WORLD-STYLE ×2 trial and zoom-out.
  Check light and dark terrain, slopes, neighbouring buildings and actors crossing the base.
- Verify no rectangular halos, doubled dark bands, terrain seams or marks left after an object is
  removed. Final visual acceptance is human; a rejected trial is a valid result.
- If adopted, cover placement and lifecycle at the lowest useful layer, measure any material render
  cost, and run the applicable gates from `docs/TESTING.md`.
