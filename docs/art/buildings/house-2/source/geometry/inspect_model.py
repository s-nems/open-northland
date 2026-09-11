"""Render an untouched Meshy model in an isolated Blender process."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'raw.glb'))
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
bpy.context.view_layer.update()
points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (low + high) / 2
span = max(high - low)
report = {'bounds_min': list(low), 'bounds_max': list(high), 'objects': []}
for o in meshes:
    parent = list(range(len(o.data.vertices)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in o.data.edges:
        a, b = (find(i) for i in e.vertices)
        parent[a] = b
    components = {}
    for v in o.data.vertices:
        components.setdefault(find(v.index), []).append(v.index)
    report['objects'].append({'name': o.name, 'vertices': len(o.data.vertices), 'faces': len(o.data.polygons), 'materials': [m.name if m else None for m in o.data.materials], 'connected_components': len(components), 'largest_components_vertices': sorted([len(v) for v in components.values()], reverse=True)[:30]})
(root / 'geometry.json').write_text(json.dumps(report, indent=2))
world = bpy.data.worlds.new('Study world')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.65, .65, .65, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .7
scene.world = world
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = span * 1.65
scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=center + Vector((-2, -3, 5)) * span)
light = bpy.context.object
light.data.energy = 180 * span ** 2
light.data.shape = 'DISK'
light.data.size = span * 3
light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
clay = bpy.data.materials.new('Geometry inspection grey')
clay.diffuse_color = (.48, .48, .48, 1)
for angle, label in [(22.5, 'front'), (112.5, 'right'), (202.5, 'back'), (292.5, 'left')]:
    az, el = math.radians(angle), math.radians(28.5)
    camera.location = center + Vector((math.sin(az)*math.cos(el), -math.cos(az)*math.cos(el), math.sin(el))) * span * 5
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.view_layers[0].material_override = None
    scene.render.filepath = str(root / (label + '-textured.png'))
    bpy.ops.render.render(write_still=True)
    scene.view_layers[0].material_override = clay
    scene.render.filepath = str(root / (label + '-geometry.png'))
    bpy.ops.render.render(write_still=True)
scene.view_layers[0].material_override = None
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'inspection.blend'))
