# Draw the in-house craft programs' scenery overlays

**Area:** render, app · **Focus:** in-house animation · **Priority:** P3

A `gfxanimmode 2` program scripts scenery beside the worker, and only the worker is drawn today. The
extracted `GfxInHouseProgram.entries` already carry both overlay kinds and the scene ignores them:

- `landscape` - a `[GfxLandscape]` record at a pixel offset for a window, which is the smith's forge
  fire (`"fx fire small"` twice per swing pass) and the druid's fire and smoke;
- `houseBob` - one of the workplace's own `[GfxHouse]` bob layers redrawn at an offset, which the
  smith's program calls six times across its length.

Consequence: a smith hammers over a cold forge, and every choreographed worker draws over the whole
house instead of behind the layer the program redraws in front of him. Entry order carries the depth:
read as "an overlay before the active entry draws behind the worker, one after it in front" it accounts
for the smith's records, whose overlay windows complement his clip windows exactly. That reading is not
decoded from the engine, so confirm it against the running original before building on it.

The worker's own depth has the same gap. `applyInHousePose` shifts the item up to 44 px down-screen, more
than the 38 px row step, but leaves `item.depth` on the house's own row, so a sprite genuinely in front of
the house can paint under him.

## Scope

- Emit the active overlays from the scene alongside the worker's own item, anchored on the same house
  and ordered by that rule, and resolve them in the sprite pool against the landscape and building
  atlases the sheet already loads.
- Depth-sort the worker and his overlays on their drawn offset rather than on the house's anchor row.
- Non-goal: the overlay's own animation cadence beyond what the landscape record's frame list gives.

## Verify

- Unit over a synthetic program: the chosen depth reading holds both ways round the active entry, and
  an overlay whose window is closed emits nothing.
- Human pass on `?scene=chain` once a smithy is in it, or on a decoded map with a staffed smithy: the
  forge glows while the smith works and goes out between passes.
