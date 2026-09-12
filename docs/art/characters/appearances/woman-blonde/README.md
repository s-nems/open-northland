# Blondynka

Adult woman with a blonde braid, ochre bodice and cream skirt. Selected through runtime
`job-selection.json`; she uses her own walk/idle binding and the shared camera receipts.

`concept/` and `head/concept/` hold production views; `model/`, `head/model/`, `restyle/`
and `projected/` hold the geometry, motions and matching textures. Keep `recipe.json`,
`layout.json`, head socket and selected strips for export.

`model/prepare-skirt.py` creates the skinned skirt from `rigged-source.glb` and `walk-source.glb`.
`model/prepare-walk.py` derives `walk-upright.glb` from `walk.glb`, with local X posture
corrections of −7° at `Spine01` and −5° at `neck` (artistic approximation). It retains the
head socket, leg motion and clip timing. Run it with Blender before rendering walk.
`model/make-idle.py` transfers the Meshy Motion Prime clip in `model/idle-motion/` onto the
matching skirt rig. The six-second idle places the right hand on the hip and looks in both
directions. Cleanup plants the ankles and blends the final 1.5 seconds back to the first pose;
body and shoulder motion remain generated. An idle-only neck correction raises the chin by 6°
and offsets the neck 2.5 cm upward and 1 cm backward (artistic approximation), preserving
the generated head turns. Run it with Blender before rendering idle.
Idle retains 16 poses from source phases 0.25–0.625 for a held head-turn gesture.
The six-second playback visits them forward and backward, reusing cells through `frameOrder`.
Transitions use 1/12-second steps; each endpoint holds for 11/6 seconds. This pose selection and
timing are artistic approximations, not the original game's choreography.
The skirt has a dedicated UV strip;
run `model/guard-garment.mjs` after projection. Check skirt deformation and neck seams in turns.

```sh
SCRIPTS=tools/art-pipeline/authoring/characters
RUN=docs/art/characters/appearances/woman-blonde
python3 "$SCRIPTS/run-character.py" "$RUN" "$RUN/model" render pack
npm run art -- build characters/woman-blonde
npm run art -- review characters/woman-blonde
python3 "$SCRIPTS/update-character-catalog.py"
```
