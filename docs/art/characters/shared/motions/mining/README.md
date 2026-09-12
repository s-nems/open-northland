# Stone mining motion

`motion/` retains the Meshy Motion Prime request, receipts, source FBX and retargeted GLB.
`prepare.py` removes lateral torso rotation while retaining the generated forward bend, hip motion
and head nod. It fits the two-hand grip along an overhead arc, raises and retracts the shoulders
during the backswing, plants the feet with forward knee poles and closes the loop. Elbow poles point downward while
retaining the achieved wrist contacts. These contact and shoulder adjustments
are authored visual approximations. Palms face the handle with their finger axis perpendicular
to the shaft; the return uses the same grip orientation. `cycle.json` owns source sampling and the tool trajectory.

Playback uses 16 poses over 29/24 seconds. Lift and strike poses last 0.035–0.06 seconds;
recovery poses last approximately 0.093 seconds. The stored sequence starts during recovery so
impact pose 11 begins at elapsed tick 10. Two complete visual swings fit the 29-tick stone-harvest
atomic without a phase reset. Resource yield and gameplay events remain sim-owned; the additional
visual strike does not grant another resource. Pose sampling and playback timing are recipe inputs.

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
