# Drop detail as the view zooms out, behind a graphics setting

**Area:** render, app · **Focus:** world-renderer, sprite-pool, settings · **Priority:** P3

`MIN_ZOOM` (`packages/app/src/view/camera/pan-zoom.ts`) is 0.35, so the widest view covers about eight
times the world area of zoom 1 and the visible set grows with it, while every layer draws at every
scale: cast and soft shadows, settler head overlays, environment motion, bubbles, badges, hearts,
construction signs and decor shadows. `packages/render/AGENTS.md` requires a deliberate
level-of-detail strategy for a wider view and none exists.

## Scope

- Measure first on a developed settlement: frame cost and drawn counts at zoom 1, 0.7, 0.5 and 0.35,
  per layer, on a real GPU (headless Chromium timing is not evidence).
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
