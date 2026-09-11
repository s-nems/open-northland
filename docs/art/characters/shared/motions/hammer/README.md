# Construction motion

`motion/` holds the generated source and API receipts. `cycle.json` prepares `hammer.glb`.
The appearance recipes select 12 poses, playback holds, limb texture and the tool socket.
Construction uses atomic 39: a 1.25 s loop with contact near 1/3 s.
Timing basis: `DataCnmd/atomicanimations12/atomicanimations.ini`, `viking_builder_build_house`,
15 ticks with sound at tick 4. Visual contact timing is approximate; the sim owns progress and events.

```sh
SCRIPTS=tools/art-pipeline/authoring/characters
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" -b \
  --python "$SCRIPTS/work-cycle.py" -- docs/art/characters/shared/motions/hammer/cycle.json
```

Re-export all four male appearances together using [PIPELINE.md](../../../PIPELINE.md).
Reuse their walk cameras and saved layouts. The [hammer](../../../equipment/carpenter-hammer/README.md)
is rendered with the body; check grip, raised-arm paint leakage, beard clearance and contact
by placing a building on a normal `assets=own` map.
