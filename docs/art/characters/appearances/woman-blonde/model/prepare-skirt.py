import math
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector

root = Path(__file__).resolve().parent
source, destination = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str((root/source).resolve()))
body = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o:len(o.data.vertices))
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
material = body.data.materials[0]
shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
image_node = shader.inputs['Base Color'].links[0].from_node
image = image_node.image
image.colorspace_settings.name = 'Non-Color'
w, h = image.size
source_pixels = np.array(image.pixels[:]).reshape(h, w, 4)
bm = bmesh.new()
bm.from_mesh(body.data)
uv_data = bm.loops.layers.uv.active
remove = []
for face in bm.faces:
    center = body.matrix_world @ face.calc_center_median()
    if .285 < center.z < .84 and abs(center.x) < .29:
        uv = face.loops[0][uv_data].uv
        r, g, b, _ = source_pixels[min(h-1, int(uv.y*h)), min(w-1, int(uv.x*w))]
        if min(r,g,b) > .25 and g > r*.85 and b > r*.7:
            remove.append(face)
bmesh.ops.delete(bm, geom=remove, context='FACES')
bm.to_mesh(body.data)
bm.free()
print('Removed split garment faces:', len(remove))
image.scale(2048, 1516)
pixels = np.empty((2048, 2048, 4), dtype=np.float32)
pixels[:] = (.86, .82, .72, 1)
pixels[:1516] = np.array(image.pixels[:]).reshape(1516, 2048, 4)
atlas = bpy.data.images.new('Garment base', 2048, 2048, alpha=True)
atlas.colorspace_settings.name = 'sRGB'
atlas.pixels.foreach_set(pixels.reshape(-1))
atlas.filepath_raw = str(root/'garment-base.png')
atlas.file_format = 'PNG'
atlas.save()
atlas.pack()
for node in material.node_tree.nodes:
    if node.type == 'TEX_IMAGE' and node.image == image:
        node.image = atlas
for uv in body.data.uv_layers.active.data:
    uv.uv.y *= 1516/2048

segments, rings = 64, 13
vertices, faces = [], []
inverse = body.matrix_world.inverted()
for row in range(rings):
    t = row/(rings-1)
    z = .29 + .54*t
    rx, ry = .273-.101*t, .166-.011*t
    for col in range(segments+1):
        angle = math.tau*col/segments
        fold = 1 + .012*math.cos(angle*12)*(1-t)
        vertices.append(inverse @ Vector((rx*math.cos(angle)*fold, .035+ry*math.sin(angle)*fold, z)))
for row in range(rings-1):
    for col in range(segments):
        a = row*(segments+1)+col
        faces.append((a, a+1, a+segments+2, a+segments+1))
mesh = bpy.data.meshes.new('Continuous skirt')
mesh.from_pydata(vertices, [], faces)
mesh.materials.append(material)
skirt = bpy.data.objects.new('Continuous skirt', mesh)
bpy.context.collection.objects.link(skirt)
skirt.matrix_world = body.matrix_world.copy()
uv_layer = mesh.uv_layers.new(name='UVMap')
for poly in mesh.polygons:
    poly.use_smooth = True
    for li in poly.loop_indices:
        vi = mesh.loops[li].vertex_index
        row, col = divmod(vi, segments+1)
        uv_layer.data[li].uv = (.015+.97*col/segments, .755+.23*row/(rings-1))
hips = skirt.vertex_groups.new(name='Hips')
left = skirt.vertex_groups.new(name='LeftUpLeg')
right = skirt.vertex_groups.new(name='RightUpLeg')
for vi, vertex in enumerate(vertices):
    row, col = divmod(vi, segments+1)
    t = row/(rings-1)
    leg_weight = .95*(1-t)**1.25
    x = (body.matrix_world @ vertex).x
    left_share = max(0, min(1, .5+x/.22))
    hips.add([vi], 1-leg_weight, 'REPLACE')
    left.add([vi], leg_weight*left_share, 'REPLACE')
    right.add([vi], leg_weight*(1-left_share), 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
skirt.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
material.surface_render_method = 'DITHERED'
material.use_backface_culling = False
bpy.ops.export_scene.gltf(filepath=str(root/destination), export_format='GLB', export_animations=True)
