import bpy
import math
import json
from pathlib import Path
from mathutils import Matrix

out = Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(out.parents[1] / 'calibrated.blend'))
scene = bpy.context.scene
turn = Matrix.Rotation(math.radians(-45), 4, 'Z')
for obj in scene.objects:
    if obj.type == 'MESH':
        obj.matrix_world = turn @ obj.matrix_world
bpy.context.view_layer.update()
scene.render.filepath = str(out / 'geometry.png')
scene.cycles.samples = 32
bpy.ops.render.render(write_still=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'geometry.blend'))
(out / 'rotation.json').write_text(json.dumps({'modelRotationZDegrees': -45, 'source': 'docs/art/buildings/headquarters/calibrated.blend', 'cameraUnchanged': True}, indent=2))
