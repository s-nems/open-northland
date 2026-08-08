# Cut the per-frame render CPU baseline for 120 Hz headroom

**Area:** render, app · **Focus:** world-renderer · **Priority:** P2 · **Complexity:** high

With only ~290 sprites drawn, the render half of a frame costs ~4-5 ms CPU (live magiczny_las probe,
rev fb833032: paused-session cpuMs 1.8 ms is the floor, the running session's draw EMA 4.1-4.9 ms).
That is over half the 8.3 ms budget at 120 Hz before the sim spends anything, and it grows with
drawn count - a late-game city view or a big battle multiplies it. In the 30 s V8 profiles the
steady per-frame terms are Pixi's `collectRenderables`/`_buildInstructions` walk (~7.4% of sampled
CPU self), the per-frame `collectSpriteScene` rebuild and its DrawItem allocations (~5.3%),
`tall-blocks` map-object updates (~2%), and `sortChildren` on the shared depth-sorted layer.

## Scope

- Measure first per term (the `?debug=trace` frame slices split sim/snapshot/draw): attribute the
  baseline between Pixi scene walk, scene build, map objects, and depth sort before changing any.
- Candidate cuts, each its own hunk: reuse scene-item arrays across frames instead of fresh
  allocation; skip depth re-sort when no z changed; fewer live containers under the world layer so
  Pixi's instruction walk touches less; rebuild Pixi instructions only when the drawn set changed.
- Do not trade correctness of painter order or fog gating; the acceptance scenes must render
  identically.

## Verify

- Paused-session cpuMs and running drawMs both drop on the live probe; the >12 ms frame count at
  tick ~23k falls.
- A screenshot scene comparison stays pixel-identical where the scene is deterministic.
- `npm test`, `npm run check`, `npm run build`, plus human review of one live session.
