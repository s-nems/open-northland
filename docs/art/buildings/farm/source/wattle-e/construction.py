"""Render an authored timber frame registered to the farm's calibrated camera."""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'calibrated.blend'))
scene = bpy.context.scene
camera = scene.camera
for obj in list(scene.objects):
    if obj.type == 'MESH':
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.data.orphans_purge(do_recursive=True)
right = camera.rotation_euler.to_matrix() @ Vector((1, 0, 0))
up = camera.rotation_euler.to_matrix() @ Vector((0, 1, 0))
forward = camera.rotation_euler.to_matrix() @ Vector((0, 0, -1))
units = camera.data.ortho_scale / 1024
parts = []
wood = bpy.data.materials.new('Weathered frame timber')
wood.use_nodes = True
shader = wood.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value = (.23, .17, .105, 1)
shader.inputs['Roughness'].default_value = 1
nodes, links = wood.node_tree.nodes, wood.node_tree.links
noise = nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 9
noise.inputs['Detail'].default_value = 2
ramp = nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (.11, .085, .055, 1)
ramp.color_ramp.elements[1].color = (.32, .245, .16, 1)
links.new(noise.outputs['Fac'], ramp.inputs[0])
links.new(ramp.outputs[0], shader.inputs['Base Color'])


def at_height(pixel, z):
    ray = camera.location + right * ((pixel[0] - 512) * units) + up * ((512 - pixel[1]) * units)
    return ray + forward * ((z - ray.z) / forward.z)


def beam(name, a, b, width=.14, start=.1, end=.45):
    a, b = Vector(a), Vector(b)
    delta = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=7, radius=width / 2, depth=delta.length, location=(a + b) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(wood)
    parts.append({'name': obj.name, 'start': start, 'end': end, 'a': list(a), 'b': list(b), 'width': width})
    return obj


# Image measurements constrain visible supports; hidden supports are an architectural approximation.
feet = [(207, 845), (347, 932), (592, 966), (733, 956), (821, 890), (884, 822)]
tops = [604, 608, 644, 660, 587, 517]
posts = []
for i, (pixel, top) in enumerate(zip(feet, tops)):
    a = at_height(pixel, .08)
    height = (pixel[1] - top) * units / math.cos(math.radians(28.5))
    b = a + Vector((0, 0, height))
    posts.append((a, b))
    beam('Main post', a, b, .20, .12 + i * .012, .38 + i * .012)
for i in range(len(posts) - 1):
    a, b = posts[i], posts[i + 1]
    beam('Wall plate', a[1], b[1], .16, .36, .55)
    if i != 1:
        beam('Sill', a[0], b[0], .17, .02, .12)
        beam('Wattle rail', a[0].lerp(a[1], .57), b[0].lerp(b[1], .57), .13, .38, .57)
        beam('Brace', a[0].lerp(a[1], .3), b[0].lerp(b[1], .58), .10, .3, .52)
beam('Door lintel', at_height((366, 628), 2.55), at_height((580, 653), 2.55), .17, .38, .55)
ridge_front = at_height((506, 254), 4.75)
ridge_back = at_height((597, 140), 4.9)
for i, (_a, b) in enumerate(posts):
    beam('Hip rafter', b, ridge_front if i < 4 else ridge_back, .14, .57, .93)
beam('Ridge', ridge_front, ridge_back, .19, .82, 1)
for i in range(4):
    a = at_height((245 + i * 10, 940 + i * 3), .10 + i * .08)
    b = at_height((303 + i * 10, 956 + i * 3), .10 + i * .08)
    beam('Site timber', a, b, .14, 0, 0)
for a, b in zip(posts, posts[1:]):
    if a == posts[1]:
        continue
    beam('Site perimeter', a[0], b[0], .08, 0, 0)
scene.cycles.samples = 24
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
calibration = json.loads((ROOT / 'calibration.json').read_text())
camera.location += up * calibration['constructionShiftY'] * units
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'construction.blend'))
(ROOT / 'construction-parts.json').write_text(json.dumps(parts, indent=2))
for part in parts:
    bpy.data.objects[part['name']].hide_render = part['end'] != 0
scene.render.filepath = str(ROOT / 'site-base.png')
bpy.ops.render.render(write_still=True)
for part in parts:
    bpy.data.objects[part['name']].hide_render = part['end'] == 0
scene.render.filepath = str(ROOT / 'frame.png')
bpy.ops.render.render(write_still=True)
for part in parts:
    obj = bpy.data.objects[part['name']]
    material = bpy.data.materials.new(part['name'] + ' timing')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    coordinates = nodes.new('ShaderNodeTexCoord')
    xyz = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coordinates.outputs['Generated'], xyz.inputs[0])
    scale = nodes.new('ShaderNodeMath')
    scale.operation = 'MULTIPLY_ADD'
    scale.inputs[1].default_value = part['end'] - part['start']
    scale.inputs[2].default_value = part['start']
    links.new(xyz.outputs['Z'], scale.inputs[0])
    emission = nodes.new('ShaderNodeEmission')
    links.new(scale.outputs[0], emission.inputs[0])
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(emission.outputs[0], output.inputs[0])
    obj.data.materials.clear()
    obj.data.materials.append(material)
scene.view_settings.view_transform = 'Raw'
scene.render.filepath = str(ROOT / 'frame-time.png')
bpy.ops.render.render(write_still=True)
