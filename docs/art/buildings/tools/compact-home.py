"""Keep a lighter editable shadow scene while retaining the full Meshy GLB losslessly."""
import json
import sys
from pathlib import Path

import bpy

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
path = root / 'house-finished.blend'
bpy.ops.wm.open_mainfile(filepath=str(path))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
before = sum(len(obj.data.polygons) for obj in meshes)
for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Shadow silhouette budget', 'DECIMATE')
    modifier.ratio = min(1.0, 450000 / before)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
after = sum(len(obj.data.polygons) for obj in meshes)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
(root / 'scene-storage.json').write_text(json.dumps({
    'fullGeometry': 'raw.glb.gz',
    'scenePurpose': 'Editable calibrated shadow geometry; final painting uses the retained full-detail render.',
    'facesBefore': before,
    'facesAfter': after,
    'method': 'Blender collapse decimation; no changes to camera, model bounds or entrance calibration.'
}, indent=2) + '\n')
