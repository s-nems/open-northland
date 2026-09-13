"""Reduce a retained home's footprint and upper mass without lowering its doorway."""
import hashlib
import json
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
config = json.loads((root / 'reshape.json').read_text())
source = root / config['sourceScene']
calibration = json.loads((root / config['sourceCalibration']).read_text())
bpy.ops.wm.open_mainfile(filepath=str(source))
scene = bpy.context.scene
camera = scene.camera
pivot = calibration['doorTop'][2]


def reshape(point):
    return Vector((point.x * config['widthScale'], point.y * config['depthScale'],
                   pivot + (point.z - pivot) * config['upperHeightScale']
                   if point.z > pivot else point.z))


for obj in [o for o in scene.objects if o.type == 'MESH']:
    inverse = obj.matrix_world.inverted()
    for vertex in obj.data.vertices:
        vertex.co = inverse @ reshape(obj.matrix_world @ vertex.co)
    obj.data.update()
bpy.context.view_layer.update()
for key in ['doorTop', 'doorFoot', 'doorGround']:
    calibration[key] = list(reshape(Vector(calibration[key])))
for key in ['boundsMin', 'boundsMax']:
    calibration[key] = list(reshape(Vector(calibration[key])))
scene.render.resolution_x = scene.render.resolution_y = 1536
scene.render.resolution_percentage = 100
scene.render.filepath = str(root / 'render.png')
bpy.ops.render.render(write_still=True)
for point, pixel in [('doorTop', 'doorTopPixel'), ('doorFoot', 'doorFootPixel'),
                     ('doorGround', 'entrancePixel')]:
    projected = world_to_camera_view(scene, camera, Vector(calibration[point]))
    calibration[pixel] = [projected.x * 1536, (1 - projected.y) * 1536]
calibration['basis'] = 'Retained calibrated scene reshaped by reshape.json; doorway height preserved. Original front-elevation measurements precede reshaping.'
calibration['sourceSceneSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
calibration['reshapeScriptSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
(root / 'calibration.json').write_text(json.dumps(calibration, indent=2) + '\n')
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'house-finished.blend'), compress=True)
