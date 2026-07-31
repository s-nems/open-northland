# Make the remaining per-frame snapshot passes screen-bounded, not map-bounded

**Area:** render + app · **Priority:** P1

On `magiczny_las` the snapshot holds ~36 950 entities while ~215 sprites are drawn, and root
`AGENTS.md` rule 6 puts per-frame work on the screen. Two full-entity passes remain, one per frame and
one per tick. A spectator session (`?player=overseer`, or `fog=reveal`) is the worst case: `fogView` is
null, so no consumer culls by visibility.

- **Per frame.** `collectSpriteScene` (`render/data/scene/sprite-scene.ts`) is the expensive one and it
  is not memoized: the retained pool's `reconcile` (`gpu/sprite-pool/sprite-pool.ts`) calls it every
  frame, not every tick, because its options carry the viewport. It skips `staticRefs` early but still
  probes all ~36 950 ids. It needs a tested spatial query so the draw-list build tracks the viewport,
  per the render contract's "add a tested spatial query rather than weakening culling". Note its second
  product, `liveRefs`, is viewport-independent but must still exclude `staticRefs`, whose set the caller
  mutates in place between frames.
- **Per tick, app.** With a non-empty selection the details panel derives a model per tick
  (`hud/details-panel/rebuild-gate.ts` returns early only on snapshot identity, and the
  `VALUE_REBUILD_MIN_MS` throttle gates the texture bake, not the derive), and
  `hud/details-panel/model/index.ts` resolves the selection by walking `entities`. Resolve it through
  `entityById`'s binary search instead: O(k log N) beats O(N) for any real selection. It cannot reuse
  `actorsOf`, because the classifier also reads `Signpost`. A selected building adds
  `building-workers.ts`, `worker-selection.ts` and, for a farm, `model/building-production.ts`.

Either piece is shippable alone. Changing the snapshot's own shape (a persistent patched array, or an
id-keyed index consumers share) stays the larger follow-up, out of scope here. Its prerequisite is
reliable `World.write` coverage, noted in [steady-allocation-churn](../sim/steady-allocation-churn.md).

## Verify

`window.__opennorthland.perf()` on
`?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal&debug=profile`, same tick horizon before
and after, comparing `frame.snapMs` and `frame.drawMs` against the paused-frame floor. Read
`sampling.hidden` first: a background tab throttles the frame loop and voids every millisecond. Take
two runs per side; single runs on a shared machine vary by ~10% on these numbers.

`npm test`, `npm run check`, `npm run build`. Visual output should be unchanged, so a human browser
pass only needs to confirm sprites, door badges, settler bubbles and minimap dots still appear where
they did.
