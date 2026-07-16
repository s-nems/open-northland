# Water-surface polish: verify the shader animation, decide shore foam

**Area:** render + app · **Origin:** map-visual-fidelity plan reconciliation, 2026-07-12; reworked by
the visual-polish batch, 2026-07-16 · **Priority:** P3

Resolved on the visual-polish branch (evidence pinned there):

- **`fx wave` records** — investigated and deferred permanently: the 8 `GfxDynamicBackground`
  records point at `test_effect.bmd`, whose decoded frames are literal placeholder art (solid
  yellow/orange rectangles + a target blob — see `content/.../test_effect.*.png`); the engine drew
  the effect procedurally (`dynamicBackground: true`, no palette). Drawing the bob would paint
  rectangles over water. The shader water animation below is OpenNorthland's replacement.
- **`lmms`** — decoded into `maps/<id>.json` `shore` (half-cell lane collapsed to cell-centre nodes;
  observed byte values 0..7). It is NOT a water mask: 18 genuinely waterless owned maps carry the
  same 1..7 bands (e.g. `battle_for_the_four_hills_multiplayer`, `ucieczka_z_gazy` — re-probed
  2026-07-16; an earlier note citing `Tale_of_Six_Sons` was wrong, that map draws water), band 7
  sits mostly under LAND patterns on river maps (`blekiny_nurt`: 2035/2036 band-7 cells), and even
  bands are nearly absent in the per-cell collapse (a possible node-parity effect of sampling centre
  nodes) — so the band semantics are unconfirmed and NOTHING consumes the lane yet. The render's
  wave field keys off ground-pattern names instead (`packages/render/src/data/water.ts`). Any foam
  work below must first re-establish what the bands mean (probe the half-cell lane directly, not the
  per-cell collapse).
- Water surface now animates: per-node wave amplitudes + tick-driven vertex bob and brightness
  shimmer in the shaded ground shader (`gpu/shading.ts`), deterministic under `?shot`.

Remaining work:

1. **Human pass on the water animation** — amplitude/period/shimmer constants in `gpu/shading.ts`
   are eye-tuned; A/B against the running original on a river map (`?map=` a bridge/coast map) and
   retune.
2. **Shore foam (optional enhancement)** — decide whether to add a foam/shore gradient using the
   decoded `shore` lane (gated on the map actually drawing water patterns, per the caveat above),
   e.g. a translucent white band overlay in the shore rings. Defer-with-evidence allowed if the
   baked transitions already read well.

## Verify

- Side-by-side river/shore crops against locally captured reference images — **user's eyes**.
