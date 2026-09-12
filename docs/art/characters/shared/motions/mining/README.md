# Stone mining motion

`motion/` retains the Meshy Motion Prime request, receipts, source FBX and retargeted GLB.
`prepare.py` removes lateral torso rotation while retaining the generated forward bend, hip motion
and head nod. It fits the two-hand grip along an overhead arc, raises and retracts the shoulders
during the backswing, plants the feet and closes the loop. These contact and shoulder adjustments
are authored visual approximations. Palms face the handle with their finger axis perpendicular
to the shaft; the return uses the same grip orientation. `cycle.json` owns source sampling and the tool trajectory.

Playback uses 16 poses over 29/12 seconds. Each pose lasts approximately 0.15 seconds; there is no
extended impact hold. Impact pose 5 begins at elapsed tick 10, followed by continuous recovery.
Atomic 25, its 29-tick length and impact timing follow the local stone-harvest binding. Gameplay
events remain sim-owned. Pose sampling and playback duration are separate recipe inputs.

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
