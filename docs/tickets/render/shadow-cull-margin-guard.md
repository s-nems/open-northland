# Pin atlas frame extents under the sprite cull margin

**Area:** render (real-content test) · **Origin:** shadow perf review, 2026-07-16 · **Priority:** P4

Sprite culling tests only the entity's anchor point against the viewport grown by
`SPRITE_CULL_MARGIN = 512` (`packages/render/src/gpu/world-renderer/frame.ts`); a frame whose pixels reach
farther than the margin from its anchor pops at the screen edge. Measured over every baked manifest
(bodies and shadow twins, 2026-07-16): everything is under the margin (worst 444 px, the `ls_caves`
sets) except the wonder atlases — `ls_wonders3` reaches **651 px** (bob 0) and `ls_wonders2`
**568 px** (bob 2). Nothing loads those two today, but a map or binding that references a wonder
will pop it at screen edges, and no test guards the invariant for the atlases that do load.

Add a real-content test (`npm run test:content` suite) that walks the baked `*.atlas.json`
manifests and asserts per frame
`max(|offsetX|, |offsetX + width|, |offsetY|, |offsetY + height|) × draw scale ≤ SPRITE_CULL_MARGIN`,
with the two wonder stems as a pinned, named exemption list. Export or mirror the margin constant so
the test and renderer can't drift. Loading a wonder family later means raising the margin or culling
by entity bounds instead of anchors — the exemption list is the prompt for that decision.

## Verify

- Test fails when the margin is artificially lowered below 444 or when a non-exempt atlas grows past
  512; passes on current content.
