# Drop detail as the view zooms out, behind a graphics setting

**Area:** render, app · **Focus:** world-renderer, sprite-pool, settings · **Priority:** P2

`MIN_ZOOM` (`packages/app/src/view/camera/pan-zoom.ts`) is 0.35, so the widest view covers about eight
times the world area of zoom 1 and the visible set grows with it, while every layer draws at every
scale: cast and soft shadows, settler head overlays, environment motion, bubbles, badges, hearts,
construction signs and decor shadows. `packages/render/AGENTS.md` requires a deliberate
level-of-detail strategy for a wider view and none exists.

Measured in the late-game `krwawa_rzeka` session (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`,
new-headless Chromium on ANGLE Metal, 1920x1080, x3), main-thread CPU only: at zoom 0.35 the main thread spends 30.7, 30.9 and 34.1 ms a frame at t81k, t92k and
t101k with 1480 to 2190 sprites drawn, 27 to 31 FPS, against 12.5 to 17 ms at zoom 1 over a dense
settlement.

Headed Chromium on Apple M2 Pro, 1440×900 at device scale 1, from tick 97200 in the
[magiczny_las measurement](../../perf/magiczny-las-late-game.md), confirms the scaling at x3:
zoom 1/0.7/0.5/0.35 draws 1751/2569/4102/6219 entities, with RAF p95
17.6/33.4/41.7/50.7 ms. The dense repeat stays at 17.4 ms with identical camera and canvas.
Separate instrumented GPU queries for the main Pixi stage (world, HUD and weather) average
4.65 ms at zoom 1 and 4.86 ms at 0.35; they exclude later insets and compositor work. CPU profiling
finds binding, scene collection and Pixi instruction work at the wider view, so measure these along
with each proposed detail tier. Frame rate and delivered simulation speed are separate measures.

## Scope

- Measure the split per layer on a developed settlement at zoom 1, 0.7, 0.5 and 0.35 from the
  reference's t80k checkpoint: main-thread CPU per layer, and GPU frame time in a headed browser
  (headless timing covers the CPU only).
- Define tiers by camera scale as named constants, each dropping what the previous did: shadows and
  soft shadows, then head overlays and environment motion, then bubbles, badges, hearts, signs and
  decor shadows, then characters as a single frame. The owner judges the look of each tier.
- A tier only narrows the player's enhancements, never turns on what a toggle turned off; portrait
  and inset subjects keep full detail.
- The tiers are a Graphics setting: automatic, or always full detail so a screenshot can show
  everything. The setting applies live and from the first frame of a launched game.
- The tiers apply inside the existing visibility pass and retained layers (sprite pool bind and
  present steps, `MapObjectLayer`, `WorldMarks`); no new walk over the world and no retained-texture
  rebuild on a tier change.

## Verify

- Frame cost at `MIN_ZOOM` stays within a stated ratio of zoom 1, with the ratio and per-layer
  numbers in the closing report.
- One screenshot per tier for the owner's visual sign-off.
- `npm test`, `npm run check`, `npm run build`.
