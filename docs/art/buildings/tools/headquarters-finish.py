"""Prepare calibrated HQ paintover targets with the shared working camera."""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
bpy.ops.wm.open_mainfile(filepath=str(root / 'inspection.blend'))
s = bpy.context.scene
meshes = [o for o in s.objects if o.type == 'MESH']
rotation = -30 if 'round' in root.name else 0
transform = Matrix.Rotation(math.radians(rotation), 4, 'Z')
for o in meshes:
    o.matrix_world = transform @ o.matrix_world
bpy.context.view_layer.update()
points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
center = (low + high) / 2
span = max(high - low)
cam = s.camera
az, el = math.radians(22.5), math.radians(28.5)
cam.location = center + Vector((math.sin(az)*math.cos(el), -math.cos(az)*math.cos(el), math.sin(el))) * span * 5
cam.rotation_euler = (center-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale = span * 1.35
bpy.context.view_layer.update()
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    shader = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE'), None)
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if shader and tex and out:
        emission = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(tex.outputs['Color'], emission.inputs['Color'])
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.inputs[0].default_value = .35
        nt.links.new(shader.outputs[0], mix.inputs[1])
        nt.links.new(emission.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs['Surface'])
s.render.resolution_x = s.render.resolution_y = 1536
s.cycles.samples = 32
s.view_layers[0].material_override = None
s.render.filepath = str(root / 'calibrated.png')
bpy.ops.render.render(write_still=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'calibrated.blend'))
(root / 'camera.json').write_text(json.dumps({
    'projection': 'orthographic', 'elevation': 28.5, 'azimuth': 22.5, 'roll': 0,
    'model_rotation_z': rotation, 'orthographic_scale': cam.data.ortho_scale,
    'camera_location': list(cam.location), 'target': list(center), 'canvas': [1536,1536],
    'basis': 'Working art camera, approximate original fit; round model rotated to face its ground entrance. Final source door must be measured after painting.',
    'shader_emission_fraction': .35,
}, indent=2) + '\n')
