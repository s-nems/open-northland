# Character production

Run commands from the repository root. Tools live in `tools/art-pipeline/authoring/characters/`;
install their dependencies with `npm ci`.
Blender defaults to `/Applications/Blender.app/Contents/MacOS/Blender`; `BLENDER` overrides it.

## Re-export selected sprites

Male recipes bind `shared/body/proportions.json` through `bodyProportions`; apply it after head
assembly for every clip. Bone scale inheritance is disabled at the listed joints to avoid compounding
limb thickness or shrinking the boots.

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

## Cast shadows

`render` automatically exports matching ground-shadow frames for character packages, using the same
poses, attachments and camera options. `pack` packs both body strips and the complete shadow atlas.
Use the normal `render pack` commands above when changing animations; there is no separate shadow
follow-up task. Character package recipes require a shadow binding, and missing or stale shadow
inputs reject the build.

For a lighting-only repair that preserves the existing body strips, use `shadows` for each model
folder, followed by `pack-shadows` on the runner. These are maintenance stages, not the normal
animation workflow. Body layout is recorded when packing, after any new clip layout is established.

The shared [lighting profile](../lighting.json) fixes direction, length and darkness to the accepted
building shadow. The exporter converts it for the character camera; do not copy building world-space
XYZ into a different camera. Profile and conversion-code hashes invalidate retained renders when
lighting changes. See [world lighting](../WORLD-STYLE.md#shared-cast-shadow-lighting) for exact values.

Each character operation in `asset.json` references `shadows/shadow.json`; a copy operation delivers
its atlas as `shadow.png`. The shadow has independent cell dimensions and foot anchors but shares
the body's frame ids and timing. Packing trims a common envelope without rescaling the silhouette.
The current projection uses evaluated geometry on flat ground with fixed directional daylight;
softness, opacity and the flat receiver are artistic approximations.

The retained receipt hashes models, poses, attachments, camera/layout files and selected body strips.
After changing an animation or its geometry, re-export its shadows and repack the complete atlas.
Changing `recipe.json` invalidates all clips for that appearance; re-export every clip before packing.
A stale receipt fails the candidate build. Concurrent animation branches must regenerate shadows
against their accepted sources before publication. Inspect the same clip and direction in the gallery
and on the real map, including contact at both feet and the carried tool.

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

- Target 12–16 stored frames per clip and facing. Authoring and delivery builds reject more than 16.
  Choose poses and holds within that budget, independently of playback duration. Review transitions
  and loop seams; spatial filtering and movement interpolation do not fill gaps between sprite poses.
- `samplePhases` selects stored source poses. `frameOrder` indexes those poses in playback order,
  including repeats and returns; `frameDurations` gives seconds per playback step and must sum to
  `duration`. A long idle should spend time holding chosen poses, with short steps during transitions.
  Body and shadow use the same frame order. Repeated steps never add texture cells.
- Existing male walk/idle use 16 poses each and hammer 12. The woman's walk uses 16 poses;
  her six-second idle uses 16 poses.
- Source strips use 192×144 cells, feet y=128. Runtime crops to 96×120, feet (48,104).
- Use `post: soft-separation`, unlit rendering, linear filtering and interpolated movement.
- Reuse `shared/body/cameras-smooth/` and the appearance's saved layout; never fit each frame separately.
- Work clips share walk-SW packing scale and identical layouts across selected male variants.
- Each appearance has its own composed atlas; additional outfit/tool combinations multiply texture storage.
  Candidate reports include body, shadow and combined base RGBA byte counts. These textures are
  shared by settlers of the same appearance; estimates exclude mipmaps and additional runtime copies.

### Pose storage and playback

Every clip (`walk`, `idle`, or an atomic work clip) accepts the same recipe timing fields:

| Field | Meaning |
| --- | --- |
| `frames` | Stored poses per facing; body and shadow each export this many cells. |
| `samplePhases` | Source-motion phase for each stored pose, independent of playback time. |
| `frameOrder` | Stored-pose indices in playback order; repeats add metadata, not image cells. |
| `frameDurations` | Positive seconds per playback step, summing to `duration`. |
| `duration` | Total playback duration, including pauses. |

Without `frameOrder`, playback visits each stored pose once in order. Without both timing arrays,
steps have equal duration. A frame order requires explicit step durations. Choose variable timing
when the motion benefits from rests, anticipation or recovery; do not add pauses to every clip by rule.

This three-pose illustration plays a turn, holds it, and returns through the middle pose:

```json
{
  "frames": 3,
  "duration": 3,
  "samplePhases": [0, 0.1, 0.2],
  "frameOrder": [0, 1, 2, 1],
  "frameDurations": [1.4, 0.1, 1.4, 0.1]
}
```

Production clips target 12–16 stored poses. Preserve short moving transitions and put long holds at
intentional rest poses; uniformly stretching sparse samples over a long source motion causes stepping.
The woman's recipe is a complete retained example. Gallery, board, game and shadow playback must
agree. Work timing changes only presentation; hit events and action duration remain sim-owned.

Walk playback follows projected distance through `walkCalibration` and `walkPlayback`.
The shared tuning is 0.8 cadence with an E-facing stride reference for all directions.
Remeasure when changing source motion or geometry; retain playback tuning:

```sh
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" -b \
  --python "$SCRIPTS/measure-walk-gait.py" -- \
  --model "$MODEL/walk.glb" --body-proportions docs/art/characters/shared/body/proportions.json \
  --out docs/art/characters/shared/body/walk-gait.json
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
