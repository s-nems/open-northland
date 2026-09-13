# Stone mining motion

`motion/` retains the Meshy Motion Prime request, receipts, source FBX and retargeted GLB.
`prepare.py` removes lateral torso rotation while retaining the generated forward bend, hip motion
and head nod. It fits the two-hand grip along an overhead arc, raises and retracts the shoulders
during the backswing, plants the feet with forward knee poles and closes the loop. Two-hand reach is limited to 84% of arm length, with downward elbow poles.
The overhead shoulder adjustment preserves the raised grip; other poses bring the handle closer to the body. These contact and shoulder adjustments
are authored visual approximations. Palms face the handle with their finger axis perpendicular
to the shaft; the return uses the same grip orientation. `cycle.json` owns source sampling and the tool trajectory.

Playback uses 16 poses over 29/12 seconds, one visual swing per stone-harvest atomic.
The owned-copy `atomicanimations12/atomicanimations.ini` defines a 29-step stone cycle;
`animation/mapmoveableanimations/animations.ini` selects 29 body frames per direction.
At the project's 12-tick clock this corresponds to approximately 2.42 seconds. This is a
reconstruction from data, not a wall-clock recording of the original executable.

The original body frames spend the end and beginning of the loop with the hammer low, with small
body movements. The authored timing approximates that rest with a 0.6875-second impact hold and a
5/12-second ready hold. Moving steps last 0.042–0.125 seconds, rather than uniformly stretching all
poses. Contact pose 11 begins at elapsed tick 19, matching the source strike-sound event. Frame durations are presentation metadata;
resource yield and gameplay events remain sim-owned.

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b \
  --python docs/art/characters/shared/motions/mining/prepare.py
python3 tools/art-pipeline/authoring/characters/run-character.py \
  docs/art/characters/appearances/man-silver docs/art/characters/appearances/man-silver \
  render pack --clips mining
```

The mining recipe uses 64 source pixels of render padding on each side to retain the full tool
without changing camera pixel density, final cell dimensions or foot anchors.

Repeat the export for all four male appearances. Preserve shared cameras, layouts and walk
calibration. Review the full loop, overhead clearance, grip and stone contact on a playable map.
The long-beard appearance still requires contact cleanup. Sources and sprites are candidates,
not approved runtime delivery.
