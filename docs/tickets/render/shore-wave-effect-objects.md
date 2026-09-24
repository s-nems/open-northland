# Draw the shore-wave effect objects

**Area:** render, app · **Focus:** map objects · **Priority:** P2

Maps place animated shore waves as landscape objects, and none of them draw. The three records
`fx wave`, `fx wave slow` and `fx wave land` (`landscapes.cif`, edit group `effects`) carry
`GfxDynamicBackground 1`, `GfxBobLibs test_effect.bmd` and no `GfxPalette`. `servedAtlasStem` needs
a palette, so `loadMapObjects` (`packages/app/src/content/objects.ts`) resolves nothing for them and
counts every placement in its `no resolvable graphics` warning.

Scale, from `content/maps/*.json`: `fx wave slow` 645,520 placements on 102 maps, `fx wave land`
12,220 on 20, `fx wave` 242 on 10. That is nearly every skipped placement in the corpus, and 104 of 123
maps log the warning (every Magiczny Las variant: 182 of 98,317, all `fx wave slow`). The fourth record,
`fx wave solid`, has palette `tree03` and already draws as an ordinary sprite.

Original behavior: a palette-less `GfxDynamicBackground` record is not a coloured sprite. The landscape
draw treats its bob as a horizontal displacement of the frame already drawn under it (the water
wobbles), and only when the level-of-detail effect option is on. Unconfirmed: how a bob pixel maps to a
shift distance, and whether the bob type in `test_effect.bmd` differs from ordinary landscape bobs.

## Scope

- Investigate first: decode `test_effect.bmd` without a palette and find out what its pixel values
  encode. Record the result as the source basis at the new draw path.
- Resolve the three records in the map-object load as effect objects rather than skipped placements,
  and draw them as a screen-space displacement of the water beneath, animated by their `GfxFrames`
  list (`loopAnimation`).
- The pass scales with the visible screen, not the placement count: a large map holds tens of
  thousands of these.
- Put the effect under the existing environment-motion setting. With motion off, draw nothing, which
  is the original's own low-detail result.
- Recheck the current water presentation (swells, glints) first. This ticket adds the authored
  per-object waves, not another general surface animation.

## Verify

- A unit test on the record resolution: the three palette-less records resolve as effects, and
  `loadMapObjects` no longer counts them as skipped. On Magiczny Las the warning disappears.
- Browser: a coast of `wyspy_polnocy` and of `magiczny_las` at normal zoom and at x2. Waves move only
  over water, stop with motion disabled, and the frame cost is measured on the densest visible coast.
- Final look: human acceptance.
