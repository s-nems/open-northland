# Own environment runtime

Run `?map=magiczny_las&assets=own&intro=off` through the normal playable map entry.
This retains decoded map geometry, simulation, collisions, elevation and brightness.
The mode replaces world graphics only; existing UI and audio remain outside this scope.
No original terrain, object, character, shadow, bubble, building-sign or combat-bones
atlases are requested by this map mode. Other entries retain their existing loaders.
The `assets` setting survives menu navigation; it is a session presentation preference,
not a simulation/save-content revision.

## Authoring and delivery

Evaluate new assets at world zoom ×2 as specified in [WORLD-STYLE.md](WORLD-STYLE.md#quality-and-characters).
The own-assets map starts at zoom ×2; `&zoom=1` provides a comparison, and the mouse wheel still works.
This scales world distances and all world layers together while UI size stays independent.
Existing map geometry and authored family scales remain independent. A source actor with 88 px
body height should use family scale 0.5: at camera ×2 it occupies 88 screen pixels.
Keep the original PNG; this transform does not downsample the delivered source file.
Use the current own civilian to validate door-to-person proportions in the building review and
on the map. Synthetic fallback actors cannot establish that ratio.

Keep source images, generation records and studies in `docs/art/`.
Use the [art pipeline](PIPELINE.md) to build, review and publish selected terrain pixels and bindings into
`packages/app/src/assets/own/terrain/`. The export is byte-identical and covered by a test.
Runtime imports these delivered files, not the authoring directory. Shared bindings and
GPU repeat baking live in `packages/app/src/content/own-assets/`; the older art diagnostic
reuses them. No original pixels are included in these exports.

### Basic Viking home

The selected [A · Stonowany remaster](buildings/house-1/index.html)
is delivered as tribe 1 / type 2 (`home_level_00`) in runtime slot `house-1`.
Its 1024px painted sprite uses scale 48/244, preserving an approximately 96px doorway at zoom ×2.
The source and export manifest are in `buildings/house-1/`.
It restyles the previous House A painting with muted straw and natural brown timber, retaining
the existing Meshy/Blender structural source. The gpt-image-1.5 true-alpha export slightly smooths
the selected concept. The earlier painting remains in `buildings/house-1/source/paint/`.
Open `?map=wilczy_lad&assets=own&intro=off&zoom=2&center=94,131` to inspect an existing basic home,
or build a basic Viking home on Magiczny Las.

The selected [muted House 2 D](buildings/house-2/README.md) is delivered as
tribe 1 / type 3 (`home_level_01`) in slot `house-2`. It adds the enclosed side room and stone base,
matching canonical A · Stonowany remaster. Its genuine-alpha 1024px sprite uses scale .25 for an approximately
96px doorway at zoom2. Review an existing player home with
`?map=tutorial_004&assets=own&intro=off&zoom=2&center=61,58`. Further home levels retain their bindings.

### Building delivery

Build sprites with [the calibrated render and final paintover method](buildings/PIPELINE.md), then use the
manifest and export steps below to deliver the selected result.

The [muted farm](buildings/farm/README.md) is delivered as basic Viking farm, tribe 1 / type 12,
matching canonical A · Stonowany remaster. Its genuine-alpha 1024px painting uses scale48/184 and
entrance(418,922), giving an approximately 96px doorway at ×2. The same package contains a freshly
rendered 1024px Blender frame and reveal masks. The
[approved construction site](buildings/farm/README.md) retains this exact muted painting
and calibration, adding a separate site base, side scaffold, ladder and later wall/door timing.
Export the complete construction delivery from `buildings/farm/`.
This shared runtime binding applies on all normal maps with `assets=own`: new basic Viking farms
show the site base, growing scaffold/frame and progressively revealed painting. Completed farms
use the final painting alone. Temporary equipment disappears at completion; other building types
retain their own construction presentation.
Review `?map=straznicypolnocy&assets=own&intro=off&zoom=2&center=26,162&fog=off` or the
`farm-construction` acceptance scene. Unsupported types remain visible placeholders.

After individual visual approval, put the PNG and `runtime.json` in the authoring directory, then run:

```sh
npm run art -- build buildings/<slot>
npm run art -- review buildings/<slot>
npm run art -- publish buildings/<slot>
```

The slot is registered in `assets.json`; its `asset.json` lists source files and delivery paths.
Build creates an isolated candidate. Review compares it with the current delivery; after individual
visual acceptance, record the displayed digest with the `approve` command described in [PIPELINE.md](PIPELINE.md).
Publish checks that approval, source freshness and conflicts across the complete runtime pack.
It removes only obsolete files owned by the selected package and can recover an interrupted publication.
The Vite runtime discovers `src/assets/own/buildings/*/runtime.json` and the accompanying PNGs.
Reload the playable map after exporting; an already running simulation need not be used for comparison.
No renderer import or ID-specific code is needed. This command does not grant visual approval.

Manifest fields:

- `tribeId`, `typeId`: verified content identity; existing map and simulation IDs.
- `layer`: unique texture-family name.
- `sprite`: local PNG filename; legacy manifests default to `B-sprite.png`.
- `width`, `height`: actual source PNG dimensions.
- `scale`: source pixels to world pixels, independent of camera zoom.
- `entrancePixel`: entrance anchor measured in source pixels.
- `doorNode`: existing footprint door offset in half-cell nodes.
- `sourceBasis`: identity evidence and artistic calibration basis.

Calibrate doors against the current actor before changing camera zoom. Missing or unloadable PNGs
and dimension mismatches retain the synthetic building and emit a content diagnostic. Invalid
manifests and duplicate identities/layers reject the pack explicitly. Unsupported building types
remain synthetic; no fallback requests original building textures.

The selected [B — hull-roof headquarters](buildings/headquarters/README.md) replaces
previous R in runtime slot `headquarters`, tribe1/type1. Its `final-muted.png` is1536×1024,
scale48/199, entrance(905,851), approximately96px doorway at zoom×2. Review
`?map=magiczny_las&assets=own&intro=off&zoom=2&center=40,40&fog=off`.
Source model, camera, muted House1 paintover, true-alpha export and calibration are in that package.


The basic Viking stonemason workshop (tribe 1 / type 29) uses the
[muted A finish](buildings/stonemason/README.md). The existing D architecture is preserved,
with built-in paintover and genuine-alpha API export. Its 1536×1024 sprite uses scale48/234,
entrance(476,862), and an approximately 96px doorway at ×2. Build a basic workshop on Magiczny Las
to inspect it; the isolated review script in the source package also places one via the admin command.
Existing upgraded type30 workshops retain placeholders. Farm construction remains bound to progress;
stonemason has no construction stages.

The [meadow/earth pack](terrain/meadow-ground/README.md) supplies ordinary, dark and deep meadow,
exposed earth and mud, with 22 named transitions. Its manifest uses verified source identifiers
only for compatibility; original pixels are not loaded. On local Magiczny Las it covers 66,432
of 91,200 ground triangles and 13,585 of 15,552 active overlays. Ground wear, colours and soft
transition edges are independent artistic approximations. The older neutral-meadow diagnostic
bindings remain available to `?art&artMap=tutorial_005`.

The [mountain pack](terrain/mountains/README.md) supplies dark, shallow rocky ground with
embedded stone grain and compact mineral earth. Map elevation and brightness supply the landform;
the texture has no painted cliff walls. The earlier gravel remains as the transition border.
Source detail is authored at twice the world size, with existing geometry and resource placement.

The [sand pack](terrain/sand/README.md) supplies 97 sand/beach patterns and both sand transitions.
It adds a quiet generated sandy-earth material using the existing terrain baker and map units.
Review a broad sand/grass boundary with `?map=gringo&assets=own&intro=off&zoom=2&center=97,101`.
Water and coast materials remain unsupported.

The [woodland pack](terrain/woodland/README.md) adds two pines and two beeches,
with three calibrated growth sizes, an approximate procedural breeze and the post-felling stump.
The [rock pack](terrain/rocks/README.md) supplies deposits
with eight deposit silhouettes in dark grey and light khaki palettes, matching remnants, smaller debris
and map-level depletion frames. Exact map names join its validated
manifests; static and live resources share own families and ground anchors.
Build, review and publish the selected pack through `npm run art -- <command> terrain/<pack>`.

The [bush pack](terrain/bushes/README.md) adds two shrub silhouettes with empty,
flowering and fruiting paintings, using original frame budgets at source resolution ×2.
Existing map slots select the variants; live berry gathering uses the same three seasonal paintings.
Review at `center=35,18` with the same own-assets map parameters. Leaf animation is not yet reproduced.

The [grass and flower pack](terrain/meadows/README.md) adds six grass patches with separately rooted blades and two small flower patches,
replacing existing meadow slots at their original frame sizes and anchors with source resolution ×2.
Review at `center=36,60` with the same map parameters. These paintings are static; remaining flower,
reed and snow variants still use the missing-graphics fallback.

The [ferns](terrain/ferns/README.md) and [mushrooms](terrain/mushrooms/README.md)
packs add two fern palettes and 36 mushroom sprites. They replace 15,276 placements on Magiczny Las
with original frame dimensions and anchors at source resolution ×2, scale 0.5. Review at
`center=188,28` and `center=36,60`. The sprites are static and retain generated alpha; other missing
object families still appear as mint dots.

## Missing graphics

- Unsupported ground: grey checkerboard, with the map's elevation and shading.
- Unsupported transitions: translucent pink cross marking the triangle. Supported meadow/earth
  transitions resolve all six directional pair slots through own RGBA masks.
- Unsupported static landscape objects: mint dots at their actual half-cell anchors, elevated correctly.
- Viking headquarters (tribe 1 / type 1): selected B hull-roof hall, muted House1 finish.
- Basic Viking mason workshop (tribe 1 / type 29): approved v4 painted sprite.
- Other live objects and buildings: existing synthetic geometric sprite atlas.
- Minimap: diagnostic type colours; it does not yet reproduce the own terrain distribution.

Static resources use the existing placement handover when simulation takes ownership.
Static sprites keep existing renderer culling. Covered woodland objects draw their own sprites;
unsupported categories share a dot.
No cottage study is mapped onto an arbitrary building. Each building design needs separate
approval before integration. Character exports remain the other agent's work.

## Verification and next scope

Browser boot of the real map reached advancing simulation ticks, with no console errors or
warnings and no original world terrain/building/character atlases. Original GUI and goods-icon
atlases can still be requested under `/bobs/` by the HUD, so the URL prefix alone is not a world-art
check. Selected B now loads from the own headquarters slot. This is functional coverage,
not a performance benchmark or final visual approval. Original UI is still visible in review.

The meadow pack passes build, local content tests and scoped Biome checks. The full unit run
passed 5,385 tests with one 5-second replay-diagnostics timeout; that file passed all five tests
when rerun separately. Global Biome still reports unrelated art/character diagnostics.

The current terrain acceptance view is
`?map=magiczny_las&assets=own&intro=off&zoom=2&center=48,39`.
This clearing has complete meadow/earth ground and overlay coverage; missing materials elsewhere
retain their diagnostics. Woodland review views are `center=47,27` for pines and resource rocks,
and `center=12,137` for mixed beech/pine woods, with the same map and own-assets parameters.
