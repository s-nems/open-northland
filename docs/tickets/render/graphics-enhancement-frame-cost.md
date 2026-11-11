# Reduce the remaining graphics enhancement costs

**Area:** render · **Focus:** performance · **Priority:** P2

The [graphics defaults' cost basis](../../GRAPHICS.md#cost-basis) records material costs for building
grounding and magnification. The paged sampling chains and grounding overlays remain current code
paths, but the reference measurements predate the current prescale path and near-one-texel single-tap
minification branch. Remeasure before selecting a change; the old numbers are investigation leads,
not current performance guarantees.

## Scope

Use the paused, GPU-bound [per-setting loop](../../PERFORMANCE.md#per-setting-gpu-cost) with options
interleaved. Improve only costs the new measurements justify, preserving default pictures and
simulation behavior. Bound the implementation to one measured bottleneck:

- **Paged shader compile time** (`packages/render/src/gpu/terrain/shading.ts`,
  `gpu/map-objects/decor-shadow-shader.ts`, `gpu/terrain/page-samplers.ts`). Sampling still sits inside the
  page chain, including the decor shadow's soft blur. A prior fresh Direct3D relink measured that
  shadow at about 2.7 seconds on an RTX 4090. Measure the current shader variants and inlined texture
  budget before reducing duplicated sampling or page slots.
- **Grounded overlays** (`gpu/ground-foot/`, `gpu/textures/texture-cache.ts`, `gpu/map-objects/tall-blocks.ts`).
  A prior `magiczny_las` dense-town capture at zoom 1 measured 2.0 Mpx of mostly transparent overlays
  and about 0.20 ms of a 2.4 ms GPU frame on Apple M2 Pro. Test tighter band quads or meshes only if
  the current overlays retain a material cost; preserve identical coverage and edges.
- **Ground minification** (`gpu/terrain/shading.ts`). A pattern's 63 texels span 68 px across and 38 px
  down a cell, about 1.85 texels per pixel along the row axis, so at zoom 1 every ground pixel takes the
  four-tap minification. On a Radeon Vega 7 at 1920x1080 in the densest `magiczny_las` town the ground
  costs 1.7 ms of a 4.9 ms frame at zoom 1 and 2.0 of 8.0 ms at zoom 0.5, the enhanced sampling 0.5 and
  0.6 ms of that. Fewer taps change the picture, so a change needs an owner ruling on comparison shots.
- **Per-frame allocations** (`gpu/sprite-pool`, `data/scene`). Allocation sampling with collected
  objects at tick 80000, ×3, before the still-frame and combat-mark changes measured about 600 KB per
  dense-view frame and 770 KB in the widest view. Pool reconciliation accounted for 25/145 KB,
  `presentItem` about 24 KB and `assembleItem` about 25 KB. This partial scenario description is not a
  repeatable current baseline: profile current retained tracks before removing allocations. Keep binder
  stamps correct: mutating a retained layer record must not make a changed layer look unchanged.

The existing `SINGLE_TAP_FOOTPRINT` branch already avoids nearly coincident minification taps. Do not
repeat that optimization; any wider threshold is a visual change requiring an owner ruling on the
comparison pictures.

## Verify

- Report before/after paired GPU measurements at zoom 1 and 0.5 for each touched option; CPU allocation
  work also reports its current profile and frame cost. Include scenario, hardware, resolution and
  prescale settings.
- Compare paused screenshots pixel by pixel (`npm run bench:browser-shots`); world pixels stay
  identical unless the owner accepts a specific visual change.
- For paged shaders, run `npm run test:shaders -- --angle=d3d11` on Windows or through the CI shaders
  input, including fresh relink timings and the shader-budget check.
- Preserve the Direct3D sampling rule in `pageChain`: reads inside sampler selection use derivatives
  computed before the chain, an explicit level or `texelFetch`. A sampler-chain change repeats
  `magnify-off-z1`, `magnify-off-z2` and `magnify-xbr-z1` with `npm run bench:gpu` on Direct3D;
  off mode must not regress above xBR as implicit-derivative sampling previously did.
- `npm run check`, `npm run build`, `npm test`.
