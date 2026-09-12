"""Inspect and calibrate the retained woven farm reconstruction."""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
REVIEW = ROOT.parents[5] / '.art-build/buildings/farm/geometry-review'
REVIEW.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'model.glb'))
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
parent = bpy.data.objects.new('Farm calibration', None)
scene.collection.objects.link(parent)
for obj in [o for o in scene.objects if o != parent and o.parent is None]:
    obj.parent = parent
factor = 5.3 / (hi.z - lo.z)
parent.scale = (factor,) * 3
parent.location = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)) * factor
bpy.context.view_layer.update()
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('Neutral daylight')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.75, .79, .84, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .65
for material in bpy.data.materials:
    if material.node_tree:
        for node in material.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Roughness'].default_value = 1
                node.inputs['Metallic'].default_value = 0
bpy.ops.object.light_add(type='AREA', location=(-4, -6, 11))
light = bpy.context.object
light.data.energy = 1400
light.data.size = 5
light.rotation_euler = (Vector((0, 0, 2.5)) - light.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 7.2
scene.camera = camera
target = Vector((0, 0, 2.65))


def point_camera(elevation, azimuth):
    el, az = map(math.radians, (elevation, azimuth))
    camera.location = target + Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el))) * 30
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()


for name, angle in [('front', 0), ('right', 90), ('back', 180), ('left', 270)]:
    point_camera(0, angle)
    scene.render.resolution_percentage = 50
    scene.render.filepath = str(REVIEW / (name + '.png'))
    bpy.ops.render.render(write_still=True)
scene.render.resolution_percentage = 100
point_camera(28.5, 25)
scene.render.filepath = str(ROOT / 'calibrated-lit.png')
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'calibrated.blend'))
(ROOT / 'model-inspection.json').write_text(json.dumps({
    'sourceBounds': [list(lo), list(hi)], 'normalizingScale': factor,
    'provisionalHeight': 5.3, 'orthographicSpan': 7.2,
    'elevation': 28.5, 'azimuth': 25,
    'objects': [{'name': o.name, 'faces': len(o.data.polygons)} for o in meshes],
    'basis': 'Independent Meshy reconstruction; dimensions and camera are artistic approximations pending door calibration.',
}, indent=2))
