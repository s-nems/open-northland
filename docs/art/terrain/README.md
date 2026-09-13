# Terrain and environment sources

These packs supply own-assets mode. Runtime copies live in
`packages/app/src/assets/own/terrain/` and `packages/app/src/assets/own/props/`.

| Pack | Delivered content |
| --- | --- |
| [grass](grass/README.md) | Soil, grass review master and legacy binding metadata |
| [meadow-ground](meadow-ground/README.md) | Meadow, earth and clay material bindings, light/dark ground |
| [gravel](gravel/README.md) | Rocky transition texture |
| [mountains](mountains/README.md) | Mountain composition and rocky material bindings |
| [sand](sand/README.md) | Sand/beach ground and transition bindings |
| [woodland](woodland/README.md) | Four trees with growth states and the post-felling stump |
| [clay](clay/README.md) | Two clay deposits with five depletion states each |
| [rocks](rocks/README.md) | Grey/khaki deposits, depletion states, remnants and debris |
| [bushes](bushes/README.md) | Two bushes with three states each |
| [meadows](meadows/README.md) | Six grass patches and two flower patches |
| [understory](understory/README.md) | Four reeds, fourteen flowers, two winter grasses and three dense tufts |
| [ferns](ferns/README.md) | Two fern sprites and their source cells |
| [mushrooms](mushrooms/README.md) | 36 mushroom sprites |

## Sources

Each pack contains the source images, export recipe or bindings, selected exports, and generation
prompts/settings. Exporters read the source images; filenames in generation records may refer to
intermediate images that are not included.

Follow the [art contract](../AGENTS.md) and [world style](../WORLD-STYLE.md) when changing artwork.
Pack READMEs describe approximations that affect their output.

## Export and verification

Each pack has a versioned `asset.json` registered in [the asset catalog](../assets.json).
Use `npm run art -- build terrain/<pack>`, then follow the shared
[art pipeline](../PIPELINE.md#package-and-command-contract) for review, in-game preview, visual
acceptance and publication.
Alpha thresholds locate rectangular crop bounds; resampling preserves the generated silhouette.

[Terrain delivery tests](../../../packages/app/test/own-terrain-export.test.ts) and
[prop tests](../../../packages/app/test/own-props.test.ts) check delivered files, geometry and bindings.
Run `npm run test:content` to check joins against locally extracted content.
