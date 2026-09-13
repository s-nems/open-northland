# Own-art production

`tools/art-pipeline` builds our artwork from retained sources. The separate `tools/asset-pipeline`
decodes the owned game. Runtime schemas live in `packages/art-contracts` and are shared with the app.
Style and visual acceptance follow [the art contract](AGENTS.md) and [WORLD-STYLE.md](WORLD-STYLE.md).

## Setup

Run `npm ci` at the repository root, then `npx playwright install chromium` if the pinned browser is
not installed. The CLI compiles only the art tools and contracts. Blender authoring commands also
need Blender and the dependencies documented in [character production](characters/PIPELINE.md).
Normal builds use local files; they do not generate AI images, call providers or require API keys.

## Adding or revising a package

1. Choose a stable package ID and the nearest existing recipe: [building](buildings/house-2/asset.json),
   [prop atlas](terrain/ferns/asset.json), [terrain material](terrain/sand/asset.json) or
   [character](characters/appearances/man-silver/asset.json). Reuse that presentation format.
2. Define the subject, gameplay binding, expected states, source dimensions, world scale and ground
   anchor before generation. Verify compatibility IDs against owned content; art is independent.
3. Read the relevant style contract and attach its canonical reference. Generate into a separate
   candidate source folder; preserve selected masters and generation records.
4. Edit the package recipe and register a new ID in [assets.json](assets.json) when needed.
   Outputs must use unowned paths or paths already owned by this package.
5. Build and review that package, then compare its candidate in the gallery and on a real playable map.
   Record actual visual acceptance, publish, and verify the delivery. Use the
   [runtime review locations](OWN-ASSET-RUNTIME.md#review-locations).

A finish variant usually changes source pixels while retaining IDs, layout and calibration; verify
those measurements after painting. A new building or prop family also needs unique runtime IDs and
verified bindings. A new character appearance needs role selection as well as an atlas; do not add it
to normal selection before acceptance. Terrain delivery uses flat `terrain/*.json` material manifests
and `terrain/*.png` images, discovered automatically by the app. `terrain/map-bindings.json` is reserved for legacy compatibility
bindings and is not a material manifest. Image names must be PNG basenames; material IDs and
map bindings must be unique across manifests. A new presentation behavior needs a shared schema,
app adapter and focused tests; adding a recipe alone cannot introduce animation, collision or
simulation rules.

Keep one short package README with purpose, source entry points, reproduction commands and remaining
visual approximations. Commands and policy belong here; do not copy this workflow into every package.

## Source retention

Retain the exact prompt, tool/model and relevant settings, ordered input references with their roles,
selected master, and crop/edit/export parameters. Use relative paths in new records. Record each
reference hash so a changed file cannot silently replace the intended style source. Provider generation
is not reproducible from a prompt alone; selected source pixels are required build inputs.

Separate references needed to rerun an export from historical generation inputs. Keep every current
recipe dependency. Historical missing intermediates must be identified as absent; a receipt naming
one does not mean it is available. Keep original-game references local and ignored. Do not retain
credentials or signed provider download URLs. Legal provenance and visual approval are separate.

`npm run check:assets` derives source roots from registered recipe directories and their `sourceBasis`;
shared body, motion and equipment roots are listed in
[the source registry](../../scripts/own-art-sources.json). Runtime binaries must belong to a package in
[delivery.json](delivery.json). Registration establishes the provenance boundary, not visual acceptance.

Commit masters, editable geometry, required textures, recipes and runtime delivery. Keep candidates,
comparison captures and reproducible scratch renders in ignored work directories. Inspect binary size
in `git diff --stat` before committing; avoid accumulating rejected full model/render copies.

## Package and command contract

[assets.json](assets.json) explicitly registers each package's `asset.json`. Paths in a recipe's
operations are relative to that recipe; output paths are relative to `packages/app/src/assets/own/`.
A new asset normally adds sources, a recipe and one catalog entry. Do not add a script per asset.
Keep asset-specific modeling or mask-authoring scripts beside their sources; their output becomes
an input to this shared build. Prompts, provider settings, raw models and selected masters remain
source records, not runtime files.

```sh
npm run art -- list
npm run art -- build terrain/ferns
npm run art -- validate terrain/ferns
npm run art -- review terrain/ferns --port 5188
```

`build all` and `validate all` process the catalog. A build writes a candidate under ignored
`.art-build/<id>/<digest>/`, containing `delivery/`, `report.json` and, after review, `review.html`.
Sources and runtime files stay unchanged. Failed builds do not replace the current candidate.
The report hashes inputs, recipe, tool source and lockfile, records actual tool versions, and reports
crop bounds and alpha statistics. Build again when inputs or tool code change.

The review page compares runtime and candidate pixels, frames, scale and manifests. Use the frame
selector for resources and characters, and inspect light, dark and terrain backgrounds. The world
zoom control applies manifest scale; it does not increase source resolution. An atlas comparison
cannot establish world alignment, depth sorting, character contacts or doorway proportions.
Building designs still require individual visual acceptance on the playable map at zoom ×2.

Prepare an isolated playable preview before approval:

```sh
npm run art -- preview terrain/ferns
ART_CANDIDATE=.art-build/terrain/ferns/preview/own npm run dev
```

`preview` combines that candidate with the current deliveries and validates the complete pack. It
writes only ignored preview files; sources, runtime delivery and approvals remain unchanged.
`ART_CANDIDATE` is a development-only override, resolved from the repository root. Open the regular
map with `assets=own&zoom=2` and use the review locations linked above. After rebuilding a candidate,
prepare its preview again and restart the development server. Ordinary `npm run dev` uses the
committed delivery. Release builds ignore the override.

For every asset handoff, open and verify two live URLs on the same server:

- Gallery with the selected asset and useful comparisons, for example
  `?art=gallery&tab=buildings&asset=buildings/farm&compare=buildings/house-1`.
- A familiar real map with `assets=own&zoom=2`, using the gallery's map link or the
  [recorded locations](OWN-ASSET-RUNTIME.md#review-locations). State when the asset must be built or its
  exact placement is unknown; a loaded map alone does not prove the asset is visible.

Include both absolute URLs in the handoff, identify candidate or published delivery, and state what
needs visual assessment. Leave the preview server running for review. After a rebuild, refresh the
preview, restart that server and verify the links again. If extracted maps are unavailable, report
the missing map check rather than substituting a synthetic map.

After a human accepts the concrete candidate, record the **presentation digest printed by review**:

```sh
npm run art -- approve terrain/ferns --digest <review-digest> --reviewer <name>
npm run art -- publish terrain/ferns
```

Approval covers decoded RGBA pixels, image dimensions, output paths and all JSON values. JSON key
order/whitespace and lossless PNG re-encoding do not change it; pixels, anchors, scale and timing do.
The initial `existing-delivery` receipts preserve the selected runtime at migration. They do not
approve new artwork. An agent must not use `approve` to invent a human visual decision.

`publish` verifies source freshness, candidate bytes, approval, ownership and combined runtime
bindings before replacement. [delivery.json](delivery.json) records ownership; unknown or other-pack
files cannot be overwritten. Only obsolete files owned by that package are removed. Runtime files
remain committed so playing/building the game does not require authoring tools.

Publication is serialized and uses a prepared directory, backup and journal. After an interrupted
publication, stop the publishing process before `npm run art -- recover`; inspect the resulting Git
diff before retrying. `recover <id>` clears an abandoned build lock after verifying its process has stopped.
This provides process-interruption recovery, not a power-loss durability guarantee.

## Recipes and image quality

Recipes use schema version 1 and a delivery kind: `building`, `props`, `terrain`, `character` or `goods`.
They combine a small set of operations:

- `copy`: preserve a selected image or manifest byte for byte.
- `raster`: crop, fit and composite source images into a material, sprite or atlas.
- `json`: write presentation metadata, optionally using frames computed by a raster output.
- `character`: pack selected directional strips and derive the character manifest from animation settings.

For traded goods and UI icons, use the [goods package contract](goods/README.md).

For ordinary vegetation, trees and resource rocks, use the `atlas` section shown in the
[fern](terrain/ferns/asset.json), [woodland](terrain/woodland/asset.json) and
[rock](terrain/rocks/asset.json) recipes. It expands a short list of IDs, source cells, sizes, roots
and states into raster operations and runtime manifests. `atlas.sampling` selects the sampler for
the whole family. Optional `outputs` handle additional selected files, such as the woodland stump.
These recipes replace the earlier pack `recipe.json`; there is one editable source of layout data.

For raster operations, `crop` and `box` are `[x, y, width, height]` rectangles in source/output pixels.
`alphaBounds` finds the visible bounding rectangle within the crop, using alpha >16 and two pixels
of padding; it does not key the background or replace the silhouette. `fit: contain` preserves aspect
ratio; `stretch` permits independently authored horizontal/vertical scaling. Upscaling is rejected.
`align` controls positioning in the box. `frameAnchor` is a fraction of the resulting frame dimensions.
`reference` selects a separate sizing master when palette variants must retain matching frame geometry.
Transparent sprites must contain visible and fully transparent pixels. Opaque materials must be opaque;
these checks do not certify halo-free or artistically correct edges.

Existing raster recipes default to `sampling: canvas-high`, preserving the selected export method.
For a deliberate quality trial, set `sampling: lanczos3` in the atlas section or raster operation, rebuild and review.
This uses Sharp's Lanczos3 resampling and integer output placement. It can change edge softness and
small details; it is not automatically better for every asset. The recipe and report retain the choice.
Canvas still resolves crop geometry for both modes. Tool versions can affect output across machines;
approval compares the actual resulting presentation rather than assuming cross-platform byte identity.

## Verification

```sh
npx vitest run tools/art-pipeline/test
npm run test:art
npm run art -- build all
npm run art -- validate all
npm run check
npm run build
npm test
```

Synthetic tests cover rejection and publication/recovery behavior. `test:art` additionally exercises
both raster backends in the installed Chromium. Rebuilding the catalog checks
retained real sources. Changes to compatibility joins also require local content tests; changes to
the original-game decoder retain that pipeline's own verification requirements.
