# Construction motion

`motion/` retains the Meshy Motion Prime prompt, receipts, FBX motion and retargeted character GLB.
`prepare.py` selects the strike defined in `cycle.json`, removes net drift and blends the loop seam.
Two-bone contact fitting fixes both ankle positions and orientations and braces the left palm
against a vertical plane. The generated torso, hips, knees and shoulders keep moving. A downward pole
directs the right elbow below the shoulder-to-hand line while preserving the hammer hand trajectory and orientation.
The hammer passes through the palm centre, perpendicular to the wrist-to-finger axis.
The rig has no finger joints; grip detail remains the source mesh's static hand shape.

The appearance recipes select 12 poses and playback holds for atomic 39: a 1.25 s loop with contact
near 1/3 s. Timing basis: `DataCnmd/atomicanimations12/atomicanimations.ini`,
`viking_builder_build_house`, 15 ticks with sound at tick 4. The sim owns progress and events.
The wall strike and contact alignment remain visual approximations.

```sh
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" -b \
  --python docs/art/characters/shared/motions/hammer/prepare.py
```

Re-export all four male appearances together using [PIPELINE.md](../../../PIPELINE.md).
Reuse their walk cameras and saved layouts. The [hammer](../../../equipment/carpenter-hammer/README.md)
is rendered with the body; review the full-body rhythm, raised-arm paint, grip, head clearance,
loop seam and wall contact while a builder works on a normal `assets=own` map.
