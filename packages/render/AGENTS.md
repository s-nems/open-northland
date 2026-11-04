# Render package contract

`packages/render` projects snapshots into a PixiJS scene. It may use floats and GPU APIs, but it must
never mutate the simulation or read live component stores. The root
[`AGENTS.md`](../../AGENTS.md) also applies.

## Layout

`src/data/` is Pixi-free and backs `@open-northland/render/data`; `src/gpu/` draws with Pixi. Tests mirror
src under `test/data/` and `test/gpu/`; shared helpers live in `test/support/`.

| Folder | Holds |
| --- | --- |
| `data/projection/`, `data/snapshot/` | iso projection, camera, viewport; snapshot component access |
| `data/scene/` | draw items, depth bands, per-feature placement; `build/` the incremental sprite-scene build, `snapshot-readers/`, `palisades/`, `projectiles/` |
| `data/sprites/`, `data/palettes/` | sprite bindings; human palettes |
| `data/terrain/`, `data/minimap/` | ground mesh math; minimap raster |
| `data/effects/`, `data/fog/`, `data/weather/`, `data/lighting/`, `data/hud/` | effect, fog, weather, scene-grade and HUD models |
| `gpu/pixi-app/` | Pixi application setup, GL patches, adapter name, GPU frame timer, HUD supersampling |
| `gpu/world-renderer/` | the renderer, pass order, depth-sorted layer, post effects |
| `gpu/world-batch/` | batched world sprites, their shader and attribute buffer |
| `gpu/textures/`, `gpu/shaders/`, `gpu/pixel-art/` | texture caches and atlas pages; program catalog and warm-up; magnifiers and page prescalers |
| `gpu/sprite-pool/` | pooled entity sprites; `layers/` atlas layer resolution, `picking/` hit tests, `presentation/` inter-tick motion |
| `gpu/terrain/`, `gpu/map-objects/`, `gpu/still-mesh/`, `gpu/paletted-sprite/` | ground layers and shading; decor batch; still meshes; paletted sprites |
| `gpu/overlays/` | marker layers over the world; `building-signs/` badges, flags and construction signs |
| `gpu/placement/`, `gpu/selection/`, `gpu/world-views/` | placement ghost and planned nodes; selection styles and rings; portrait insets and map views |
| `gpu/blood/`, `gpu/building-damage/`, `gpu/demolition/` | blood stains; damage paint, rubble, fire; collapse and dismantle |
| `gpu/sway/`, `gpu/weather/`, `gpu/lighting/`, `gpu/ground-foot/`, `gpu/ground-waves/`, `gpu/gallery/` | cloth, vegetation and ship motion; weather; scene light; grounded feet; shore waves; animation gallery |

## Screen-bounded cost

Per-frame draw cost must follow the viewport, not total map size.

- Keep a retained scene graph. Reconcile and update display objects instead of rebuilding them each
  frame.
- Chunk static terrain and cull chunks by viewport bounds.
- Cull sprites before drawing. Keep off-screen live entities pooled and destroy only entities that
  left the snapshot. A cheap transient overlay node may instead retire on cull and re-mint on return
  when retaining it would scale with entity state, not the screen (the settler-bubble policy).
- Cache frame textures and decoded bindings.
- Preserve batching. Per-sprite filters, masks, and blend modes need a measured reason.
- Keep zoom-out bounded. A wider view needs a deliberate level-of-detail strategy.

Portrait insets (`WorldRenderer.setPortraitInsets`) take every HUD box that shows a live world cutout
this frame: the settler panel's portrait and the trade window's two houses. Each is one more framed
render of the world layer, so the cost grows with the boxes on screen, not the map; the app passes
the same list object while the boxes hold still.

A scene build takes its candidates from the snapshot's position index over the viewport
(`positionedWithin`, `data/scene/build/entity-source.ts`) and culls each candidate. The lookups a build
needs (enterable stores, the ids actors face or craft at, palisades, HUD totals) are indexes
the mirror maintains per change, read through `indexesOf`. The target-position and siege-shot readers
are per-snapshot passes over those small index lists, and the fog ghost store is render-owned, updated
per fog generation from the position index. No per-tick pass over `snapshot.entities` belongs in this
package; a build without a viewport (a screenshot entry, a test oracle) is the one full walk.

## Depth, colour, and shadows

Isometric depth decisions must be stable for the same snapshot. Keep projection, pre-lift sorting,
anchors, and cull extents in pure tested helpers where possible.

The sorted layer paints in passes, each a depth band under the next (`data/scene/depth.ts`): the still
landscape, then fish, then everything else by feet row. A landscape record joins the still pass on
`GfxStatic` alone. In CnMod 1.3.2 that is safe for every such record: across the 98 that block walking,
the sprite's top stays within 19 px (one half-cell row) of the first free row behind its
`LogicWalkBlockArea`, so nothing can stand behind one, while 227 of the 297 animated blocking records
rise above theirs. Re-measure that from `ir.json` and the served atlases before trusting a new input.
A new "what draws over what" case picks a pass or a same-anchor paint step; it does not get its own
sort-row override.

Team colour is a palette-band remap, not a whole-sprite tint. Keep custom palette rendering limited
to assets that need it because it can reduce batching.

Shadow and terrain-lighting choices need a named source basis or approximation. Do not infer a new
visual rule from a passing structural test.

## Shader size is a budget

The Direct3D shader compiler behind ANGLE on Windows inlines every GLSL function before it
optimises, so a fragment shader's cost there is its body after inlining, not its line count. A sampling path called from
each branch of a sampler if-chain compiles once per branch; that shape took minutes to compile on
Windows and froze the game at the loading screen while Metal compiled it in milliseconds, and a chain
walked once per magnifier tap still compiled for tens of seconds there. Gather every tap a fragment
reads in one pass over the chain, as `gpu/world-batch/shader.ts` does for a body's magnifier taps,
and keep xBR and the other magnifiers out of per-slot code. Its selection outline picks the page once
and reads its eight plain coverage taps there, a cost the budget below and the Windows compile check bound.
The chain picks its slot through a switch, which the Direct3D compiler handled in half the time of
the same reads in a nested if-chain. A loop the compiler unrolls in every branch costs the same way:
`gpu/map-objects/decor-shadow-shader.ts` reads its page sizes in one chain and works out the blur
weights once, so its second chain's branches hold only the guarded, weighted fetches. `test/gpu/shaders/budget.test.ts` bounds the inlined texture operations
of every program; a new GL program or generated variant joins `gpu/shaders/catalog.ts` in the same
commit so the budget and the Windows compile check (`npm run test:shaders`) see it.

## Verification

Headless tests can verify frame choice, projection, culling, reconciliation, bounds, and absence of
page errors. Headless Chromium does not provide trustworthy real-GPU frame timing.

Measure sim step, snapshot, scene update, and GPU/compositor time separately before assigning a
performance problem to render. Use a reproducible screenshot or browser scene for the final visual
check, and leave pixel judgement to a human.
