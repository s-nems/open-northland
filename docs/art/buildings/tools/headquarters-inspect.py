"""Inspect an HQ reconstruction in an isolated Blender background process."""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'raw.glb'))
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
bpy.context.view_layer.update()
points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
center = (low + high) / 2
span = max(high - low)
report = {'bounds_min': list(low), 'bounds_max': list(high), 'objects': [
    {'name': o.name, 'vertices': len(o.data.vertices), 'faces': len(o.data.polygons)}
    for o in meshes]}
(root / 'geometry.json').write_text(json.dumps(report, indent=2) + '\n')
world = bpy.data.worlds.new('Neutral daylight')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.7, .73, .77, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .7
scene.world = world
for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    shader = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if shader:
        shader.inputs['Roughness'].default_value = .95
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Specular IOR Level'].default_value = .12
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = span * 1.4
scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=center + Vector((-2, -3, 5)) * span)
light = bpy.context.object
light.data.energy = 150 * span ** 2
light.data.size = span * 3
light.rotation_euler = (center-light.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 768
scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
clay = bpy.data.materials.new('Geometry grey')
clay.diffuse_color = (.5, .5, .5, 1)
def pose(azimuth, elevation):
    az, el = math.radians(azimuth), math.radians(elevation)
    camera.location = center + Vector((math.sin(az)*math.cos(el), -math.cos(az)*math.cos(el), math.sin(el))) * span * 5
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z', 'Y').to_euler()
def render(name):
    scene.render.filepath = str(root / name)
    bpy.ops.render.render(write_still=True)
for angle, name in [(22.5, 'front'), (112.5, 'right'), (202.5, 'back'), (292.5, 'left')]:
    pose(angle, 28.5)
    scene.view_layers[0].material_override = None
    render(name + '-textured.png')
    scene.view_layers[0].material_override = clay
    render(name + '-geometry.png')
scene.view_layers[0].material_override = None
pose(0, 0)
render('front-elevation.png')
pose(22.5, 28.5)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'inspection.blend'))
