# Construction motion

`author.py` bakes `cycle.json` onto the shared idle body and writes `hammer.glb`.
The feet and torso stay planted. The right hand draws the hammer behind the head, then strikes
forward into a vertical wall at shoulder height. The socket aligns the iron head with the strike.
Poses and elbow pole use metres in the body’s -Y-facing space; this is an authored visual approximation.

The appearance recipes select 12 poses and playback holds for atomic 39: a 1.25 s loop with contact
at 1/3 s. Timing basis: `DataCnmd/atomicanimations12/atomicanimations.ini`,
`viking_builder_build_house`, 15 ticks with sound at tick 4. The sim owns progress and events.

```sh
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" -b \
  --python docs/art/characters/shared/motions/hammer/author.py
```

Re-export all four male appearances together using [PIPELINE.md](../../../PIPELINE.md).
Reuse their walk cameras and saved layouts. The [hammer](../../../equipment/carpenter-hammer/README.md)
is rendered with the body; check grip, raised-arm paint leakage, beard clearance and contact
by placing a building on a normal `assets=own` map.
