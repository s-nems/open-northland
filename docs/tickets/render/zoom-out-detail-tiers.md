# Finish the zoomed-out detail tiers: figures and small decor

**Area:** render, app · **Focus:** sprite-pool, map-objects, settings · **Priority:** P3

`packages/render/src/data/view-detail.ts` names three tiers below full detail and the Graphics setting
"Less detail when zoomed out" picks them by camera scale ([what each drops](../../GRAPHICS.md#detail-by-zoom)).
Two kinds the widest view still pays for in full are not in a tier, and three seams around the tiers
are approximate.

## Scope

- Figures at the `minimal` tier. A walking settler presents and binds on every sim tick, which at x3 is
  nearly every frame. Hold a gait pose for several ticks, or draw one resting frame per facing, without
  sliding a planted foot: an original walker keeps its tick anchor because its clip plays one authored
  frame per tick (`presentation/present-item.ts`). Measure the bind and present share of the wide view
  first; the owner judges the look.
- Small flat decor (grass, mushrooms, flowers) is packed into the per-chunk decor meshes with every
  other flat object, so it costs draws and fill but no per-frame CPU. Dropping a family needs its own
  lane or a shader cut, never a mesh rebuild on a tier change. Measure the GPU share on an integrated
  GPU before building it.
- The app still projects door badges, bubbles, hearts and stars every frame for a tier that draws none.
  Let the projections skip a kind the renderer's tier drops.
- A portrait inset keeps full detail only for its subject: the world around it draws at the main
  view's tier. A map view keeps full detail for the entities it borrows; one the main frame also draws
  keeps the main presentation.
- The thresholds were measured on the `magiczny_las` t100000 checkpoint only. Repeat the per-tier
  numbers on the `krwawa_rzeka` reference (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`) and read the GPU
  frame time in a headed browser on an integrated GPU.

## Verify

- `npm run bench:browser` with `ON_BENCH_BROWSER_WINDOWS=dense:3,zoom07:3,zoom05:3,wide:3`, automatic
  against `ON_BENCH_BROWSER_DETAIL=full`, back to back.
- One screenshot pair per changed tier (`npm run bench:browser-shots`) for the owner's sign-off.
- `npm test`, `npm run check`, `npm run build`.
