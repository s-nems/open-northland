# Sort tall walk-free landscape by row instead of under everything

**Area:** render, app · **Focus:** map-objects · **Priority:** P3

`drawsAsFlatDecor` (`packages/app/src/content/ir/joins.ts`) files every landscape record without a
`LogicWalkBlockArea` into the batched decor layer, which paints under every entity. The original draws
those of them that are not `GfxStatic` in its row-sorted pass (see the draw passes in
`packages/render/AGENTS.md`), so a settler standing behind one is covered up to the sprite's height.
Here the settler always paints over it.

For grass and mushrooms that is invisible: the sprite tops out 5 to 22 px above its anchor. It is wrong
for the tall families. Measured on the CnMod 1.3.2 corpus (123 maps), sprite top above the feet anchor
from the served atlases, against a settler of about 40 px:

| Family | Placements | Most on one map | Top, px |
| --- | ---: | ---: | --- |
| `bush`, `bush snow` | 185,546 | 5,542 | 55..60 |
| `fern`, `fern dark` | 147,041 | 4,461 | 34 |
| `schilf`, `schilf dark` | 120,714 | 4,296 | 27..30 |
| `wheat mine` | 23,067 | 4,491 | 36 |
| `tree_dead` | 7,796 | 1,331 | 40 |
| `fx fog` | 13,773 | 2,194 | 120 |

A settler walking through a thicket or a reed bed reads as walking on top of it.

## Scope

- Pick the split from data, not from family names: a walk-free, non-`GfxStatic` record whose tallest
  bound frame rises above a named height threshold joins the tall, row-sorted objects; the rest stay
  batched decor. State the threshold's basis (approximation against the settler sprite height).
- Tall objects are minted on first visibility and culled by block, so the cost to watch is the visible
  count at the widest zoom on the densest map (`magiczny_las`), not the map total. Measure scene update
  and sprite-layer sort time before and after against the 120 FPS at speed x3 budget, following
  `docs/DEVELOPMENT.md`. If the budget breaks, keep the split but raise the threshold, and record the
  number.
- Out of scope: grass, flowers, mushrooms, and the wave pass between fish and the sorted pass.

## Verify

Unit test for the height split on synthetic records. Real-content check that `bush` and `fern` records
resolve to tall objects and `grass` stays decor. Browser: a settler walked behind a bush on a real map
is covered by it and one in front is not; the perf numbers above in the completing report.
