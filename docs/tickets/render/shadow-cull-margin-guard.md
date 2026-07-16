# Pin atlas frame extents under the sprite cull margin

**Area:** render (real-content test) · **Origin:** shadow perf review, 2026-07-16 · **Priority:** P4

Sprite culling tests only the entity's anchor point against the viewport grown by
`SPRITE_CULL_MARGIN = 512` (`packages/render/src/gpu/world-renderer.ts`); a frame whose pixels reach
farther than the margin from its anchor would pop at the screen edge. Measured over every baked atlas
manifest (bodies and shadows), the worst extent today is **497 px** (`ls_houses_frank_s` bob 4,
619×281 at offset −122,−163) — safe by only 15 px, and nothing guards the invariant.

Add a real-content test (`npm run test:content` suite) that walks all `content/.../*.atlas.json`
manifests and asserts `max(|offsetX|, |offsetX + width|, |offsetY|, |offsetY + height|) ×
worst-case draw scale ≤ SPRITE_CULL_MARGIN` per frame, so a future mod atlas or scale change can't
silently introduce edge popping. Export or mirror the margin constant so the test and renderer can't
drift.

## Verify

- Test fails when the margin is artificially lowered below 497; passes on current content.
