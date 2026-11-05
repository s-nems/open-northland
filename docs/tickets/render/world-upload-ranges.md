# Upload only the world vertex ranges that changed

**Area:** render · **Focus:** still-mesh, overlays · **Priority:** P3

On `magiczny_las` t100000 at 1920x1080, wide camera (zoom 0.35), x3, Radeon Vega 7 (Windows Chrome,
ANGLE D3D11), the world uploads about 3.4 MB of vertex data per frame in about 140 calls (in-page
WebGL counters; `bench:browser` reads 3.4 MB in its uploads column):

- The still mesh's quad store (`gpu/still-mesh/quad-store.ts`) goes up as one span from its lowest to its
  highest dirty quad. Per frame about 2200 hot quads in 66 blocks change, plus about 290 scattered cold
  writes (190 of them retargets), and one cold write widens the span to the whole store: 2.5 MB, 9239 of
  9344 quads.
- About 240 bone piles fade every frame: `gpu/overlays/effects-layer.ts` sets `node.alpha` each frame, so
  the world layer's batch repacks and uploads 720-780 KB per frame without a rebuild.

What these uploads cost in milliseconds is not measured yet.

## Scope

- Measure first: CPU time in `bufferSubData` (profile) and the frame's GPU time, with the uploads as they
  are and with them cut to the hot blocks, on the Vega 7 and on Apple Metal, where every upload call
  copies the whole store (about 0.2 ms), so more spans can cost more there. Stop and delete this ticket if
  neither shows a measurable gain.
- Then split the still-mesh upload into a few spans at its largest gaps, and set a pile's alpha only when
  its packed byte changes, with the bone and wreck nodes in a render group of their own if that bounds
  the range.

## Verify

`bench:browser` wide x3 and zoom 0.5 x3, base and branch alternating twice on the Vega 7: uploads KB
and app CPU ms per frame; the same on an Apple GPU; `bench:browser-shots` with 0 differing pixels.
