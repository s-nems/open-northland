# Own assets in the game

Open `?map=magiczny_las&assets=own&intro=off`. Own-assets mode retains decoded map geometry,
simulation, collisions, elevation and brightness. `assets` is a session presentation preference;
it does not change save content or simulation state.

Runtime reads committed deliveries under `packages/app/src/assets/own/`. Authoring sources live
under `docs/art/`; [the production pipeline](PIPELINE.md) builds isolated candidates and publishes
approved deliveries. The app's `content/own-assets/` adapters translate manifests into renderer data.
Adding a building or prop with an existing presentation format needs data, not renderer branches.

## Scale and calibration

Use the [world-view trial](WORLD-STYLE.md#quality-and-characters): camera zoom ×2, unchanged map
and simulation units, and independent UI scale. `&zoom=1` compares the settlement management view.
An 88-source-pixel actor at family scale 0.5 occupies about 88 screen pixels at ×2, before
backing-store scaling. Keep the source PNG at its native resolution.

Calibrate building doors against the current own civilian. The clear door opening target is about
96 screen pixels at ×2; measure the final transparent painting, excluding the timber frame.
Camera zoom cannot correct a door-to-person mismatch. [Building production](buildings/PIPELINE.md)
owns the measurement formula and rendering method.

## Bindings

The [catalog](assets.json) registers source packages; [delivery.json](delivery.json) records ownership
of runtime files. The app discovers building, prop and character manifests from their delivered
folders. Terrain materials and compatibility bindings are delivered under `terrain/`.

A building package supplies `runtime.json`, its final PNG and optional construction layers.
The [shared schema](../../packages/art-contracts/src/building.ts) defines the fields:

| Field | Meaning |
| --- | --- |
| `tribeId`, `typeId` | Verified existing content identity |
| `layer` | Unique texture-family name |
| `sprite`, `width`, `height` | Local PNG and actual source dimensions |
| `scale` | Source pixels to world pixels, independent of camera zoom |
| `entrancePixel` | Ground entrance anchor in source pixels |
| `doorNode` | Existing footprint door offset in half-cell nodes |
| `sourceBasis` | Compatibility evidence and artistic calibration basis |
| `construction` | Optional reveal layers and progress windows on the same canvas |
| `shadow` | Optional finished-building shadow PNG with its own width, height and entrance anchor; inherits body scale and stays outside selection/hit testing |
| `selectionEllipse` | Optional authored selection geometry in source pixels |

Invalid manifests or duplicate identities/layers reject the pack. Missing or unloadable building
PNGs and dimension mismatches emit diagnostics and retain the synthetic fallback.
The farm's temporary construction layers disappear at completion; completed farms use only the final
painting. Other building packages currently have no delivered construction layers.

## Review locations

Copy view link preserves the shared animation clock, including a paused pose. Missing linked assets
or clips remain marked unavailable; they are not replaced with another preview.

Open `?art=gallery` to compare delivered own assets. Its tabs use
`tab=animations`, `tab=buildings`, `tab=terrain` and `tab=goods`; `asset=<id>` selects an entry and
`compare=<id>,<id>` pins comparison entries. For example:
`?art=gallery&tab=animations&asset=characters/man-silver&compare=characters/man-redmane`.
The gallery uses runtime manifests and shares the development server's candidate override with the
game. Source studies and unpublished packages without a prepared preview are outside this catalog.

Use the selected asset's map link for scale, movement, depth and terrain checks. It opens a real map
at zoom ×2; character links can force the selected appearance with `ownHead=<id>`. A family review
area does not guarantee every variant or resource state. Unknown placements open Magiczny Las with
an explicit context-only note. Build the stonemason there before inspecting that workshop.

Run the normal app with `npm run dev`; append these queries to its URL. For unpublished work, use
the [isolated candidate preview](PIPELINE.md#package-and-command-contract). Locations require locally
extracted maps. Use current actors, motion, elevation and zoom-out alongside close inspection.
Reload after publication so the comparison uses the new delivery.

| Subject | Query |
| --- | --- |
| Meadow clearing | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=48,39` |
| Pine growth and resource rocks | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=47,27` |
| Mixed woodland | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=12,137` |
| Bush states | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=35,18` |
| Grass, flowers and mushrooms | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=36,60` |
| Ferns | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=188,28` |
| Sand boundary | `?map=gringo&assets=own&intro=off&zoom=2&center=97,101` |
| Headquarters | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=40,40&fog=off` |
| Basic home | `?map=wilczy_lad&assets=own&intro=off&zoom=2&center=94,131` |
| Upgraded home | `?map=tutorial_004&assets=own&intro=off&zoom=2&center=61,58` |
| Farm | `?map=straznicypolnocy&assets=own&intro=off&zoom=2&center=26,162&fog=off` |

Use the `farm-construction` acceptance scene for reveal timing, and build a basic stonemason on
Magiczny Las to inspect that workshop. [Character production](characters/PIPELINE.md) covers forced
appearance previews and animation checks. Package inventories and source details live in the
[terrain index](terrain/README.md), [character index](characters/README.md), and each building README.

## Coverage and diagnostics

- Unsupported ground uses a grey checkerboard with map elevation and shading.
- Unsupported transitions use a translucent pink cross on the triangle.
- Unsupported static landscape objects use mint dots at their elevated half-cell anchors.
- Unsupported live objects and buildings use synthetic geometric sprites.
- The minimap uses diagnostic type colours; it does not reproduce own terrain distribution.

The normal own-assets map does not request original world terrain, object, character, shadow,
bubble, building-sign or combat-bones atlases. Goods packages supply ground piles and matching building-panel icons by good slug. Uncovered HUD goods icons, other UI and audio retain their existing loaders. A `/bobs/` request alone therefore does not prove original world art was loaded.
Other app entries retain their own loaders.

Static resources hand over to live simulation entities through the existing placement bindings.
A prop whose original record has no walk-block area draws as flat ground decor under every entity
when it paints at most 26 world px above its feet, about half a settler (grass and mushrooms fall
under that, bushes, ferns and reeds over it); a taller one sorts by row and hides a settler standing
behind it. A building's walk-block footprint clears the static objects under it when it is placed.
Map objects retain renderer culling. Automated checks cover bindings and loading; in-game pixels,
scale, seams, repetition, construction timing and motion still need visual review. Captures containing
original UI or world pixels stay in ignored `content/`.
