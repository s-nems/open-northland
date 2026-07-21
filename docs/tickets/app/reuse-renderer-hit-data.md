# Reuse renderer frame data for app hit targets

**Area:** app + render · **Priority:** P2

`view/unit-controls/unit-targets.ts` projects and depth-sorts the full snapshot without a viewport to
answer screen-space selection queries. `view/ground-pile-tooltip.ts` repeats a scene projection whenever
the camera moves. Both duplicate data the renderer already resolved for the same frame, so input work
scales with map entities and allocates while panning.

## Scope

- Expose the smallest read-only per-frame bounds/anchor seam needed by unit targeting and ground-pile
  hover, and consume it instead of calling `buildSpriteScene` again.
- Keep fog, ownership, pixel-hit, and marquee semantics unchanged. Do not expose Pixi objects or let app
  state mutate render pools.
- Measure the affected input/frame slices on a large map before and after.

## Verify

Selection, attack targeting, marquee selection, and ground-pile tooltip tests resolve the same ids.
`npm test`, `npm run check`, and `npm run build` pass; the profile removes the duplicate projection.

