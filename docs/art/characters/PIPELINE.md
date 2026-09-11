# Character production

Run commands from the repository root. Tools live in `tools/art-pipeline/authoring/characters/`;
install their dependencies with `npm ci`.
Blender defaults to `/Applications/Blender.app/Contents/MacOS/Blender`; `BLENDER` overrides it.

## Re-export selected sprites

Retain `recipe.json`, `layout.json`, `projected/` textures and camera receipts when rerendering.
Male walk/idle files resolve from the shared model folder; hammer resolves from the appearance folder.

```sh
SCRIPTS=tools/art-pipeline/authoring/characters
ID=man-silver
RUN="docs/art/characters/appearances/$ID"
MODEL=docs/art/characters/shared/body/model
python3 "$SCRIPTS/run-character.py" "$RUN" "$MODEL" render --clips walk,idle
python3 "$SCRIPTS/run-character.py" "$RUN" "$RUN" render pack --clips hammer
npm run art -- build "characters/$ID"
npm run art -- review "characters/$ID"
python3 "$SCRIPTS/update-character-catalog.py"
```

The woman uses her own `model/` for both clips; see her [package](appearances/woman-blonde/README.md).
`npm run art -- build characters/<id>` rebuilds a candidate atlas from retained strips without Blender.
Review and publication use the shared [art pipeline](../PIPELINE.md); the character board remains a
per-clip authoring review and does not itself authorize runtime publication.

## Body and painting

1. Generate front, left, back and right views at equal scale, in a neutral A-pose with empty hands.
   Use `shared/body/concept/sheet.png` for male proportions and `shared/body/restyle/out-facings.png`
   for painting. Base bodies must be bald and clean-shaven, with a complete collar and short neck.
2. Validate alpha. For an explicitly authorized solid-magenta workflow, use `key-background.mjs`.
   Crop the four concept views into separate images; retain their crop rectangles, exact prompt,
   source sheet and actual Meshy inputs. `restyle-cut.mjs` serves the eight-facing paint sheet below.
3. Use the matching `model/params.json` as the Meshy request template. Retain the remeshed model,
   rig, useful clips and API receipts. Rigging/remeshing can change UVs: use the rigged base texture.
4. Render a facing sheet, paint it without changing silhouettes or pose, then project it:

```sh
RUN=docs/art/characters/shared/body
MODEL="$RUN/model"
python3 "$SCRIPTS/run-character.py" "$RUN" "$MODEL" facings
# Save the selected painting as "$RUN/restyle/out-facings.png".
python3 "$SCRIPTS/run-character.py" "$RUN" "$MODEL" paint project
```

For this step, `RUN` is the body package, not an assembled male appearance.
The facing sheet is 1536×1024: SW W NW N / NE E SE S, cells 384×512, feet y=440.
Projection and painting use identical geometry and walk pose 0.
Recipes select the strongest visible view, 2048 px textures and 0.03 m depth tolerance.
`material_guard` compares projected colours with the matching rigged base texture;
it limits colour leakage but is not a semantic skin/clothing mask.
The woman's [garment guard](appearances/woman-blonde/model/guard-garment.mjs) additionally handles her skirt UV strip.

## Heads and motion

Attach heads and tools using [MODULARITY.md](MODULARITY.md). Each head owns its model, socket,
`model/base-color.png` and corrected `model/painted-base.png`; the correction must match arm skin.

`shared/motions/idle/` retains the generated source; `shared/body/model/idle.json` records retargeting.
`shared/motions/hammer/` owns the construction loop. Recipes bind it to atomic 39.
Check retargeted rest pose, segment lengths, contacts and loop seams on the target rig.
Bone-name agreement alone is insufficient. Do not regenerate a motion per facing or head.

## Timing and export

- Store 12 unique poses per clip/direction, up to 16 when needed. This is a pose budget, not FPS.
- `samplePhases` selects source poses; `frameDurations` controls playback holds. Preserve both.
- Male walk/idle use 16 poses each, hammer 12; the woman's walk uses 16 and relaxed idle 12.
- Source strips use 192×144 cells, feet y=128. Runtime crops to 96×120, feet (48,104).
- Use `post: soft-separation`, unlit rendering, linear filtering and interpolated movement.
- Reuse `shared/body/cameras-smooth/` and the appearance's saved layout; never fit each frame separately.
- Work clips share walk-SW packing scale and identical layouts across selected male variants.
- Each appearance has its own composed atlas; additional outfit/tool combinations multiply texture storage.

Walk playback follows projected distance through `walkCalibration` and `walkPlayback`.
The shared tuning is 0.8 cadence with an E-facing stride reference for all directions.
Remeasure when changing source motion or geometry; retain playback tuning:

```sh
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" -b \
  --python "$SCRIPTS/measure-walk-gait.py" -- \
  --model "$MODEL/walk.glb" --out docs/art/characters/shared/body/walk-gait.json
```

This planted-ankle measurement is a visual approximation. The sim already normalizes projected travel;
do not change sim speed or apply a second depth correction. Sim ticks, display refresh and stored
poses are independent. Presentation interpolation does not create missing limb poses or gameplay events.

## Validation

The exporter checks strip dimensions and crop bounds. The catalog preserves approval only when
PNG hashes and playback timing match. Compare runtime atlases before and after structural changes.
Review new pixels on playable maps with `assets=own&ownHead=<id>&zoom=2&intro=off`:
walk in all directions, turned idle, neck/collar seams, skin colour, tool contacts and loop seams.
Delete `.work/` and `orig-compare/` after verification; keep production inputs and selected strips.
