from pathlib import Path
import bpy, math
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
root = Path(__file__).resolve().parent

def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = 0.82
    return m
wood = [material('Oak' + str(i), c) for (i, c) in enumerate([(0.2, 0.105, 0.044), (0.27, 0.15, 0.067), (0.16, 0.072, 0.029), (0.32, 0.19, 0.084)])]
iron = [material('ForgedIron' + str(i), c) for (i, c) in enumerate([(0.19, 0.23, 0.25), (0.28, 0.32, 0.33), (0.115, 0.15, 0.17), (0.36, 0.39, 0.39)])]
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.027, depth=1.0, location=(0, 0, 0.5))
o = bpy.context.object
o.name = 'OakHandle'
for m in wood:
    o.data.materials.append(m)
for f in o.data.polygons:
    f.material_index = f.index % len(wood)
centers = [(-0.4, 0.89, 0.008, 0.011), (-0.3, 0.975, 0.025, 0.035), (-0.16, 1.025, 0.045, 0.045), (0, 1.035, 0.061, 0.052), (0.15, 1.01, 0.045, 0.043), (0.3, 0.94, 0.025, 0.028), (0.39, 0.84, 0.004, 0.006)]
v = []
for (x, z, ry, rz) in centers:
    for j in range(8):
        a = 2 * math.pi * j / 8
        v.append((x, math.cos(a) * ry, z + math.sin(a) * rz))
f = []
for i in range(len(centers) - 1):
    for j in range(8):
        f.append((8 * i + j, 8 * i + (j + 1) % 8, 8 * (i + 1) + (j + 1) % 8, 8 * (i + 1) + j))
f.extend([tuple(range(7, -1, -1)), tuple(range(8 * (len(centers) - 1), 8 * len(centers)))])
mesh = bpy.data.meshes.new('ForgedHead')
mesh.from_pydata(v, [], f)
mesh.update()
o = bpy.data.objects.new('ForgedHead', mesh)
bpy.context.collection.objects.link(o)
for m in iron:
    mesh.materials.append(m)
for p in mesh.polygons:
    p.material_index = [1, 1, 0, 2, 2, 0, 3, 3][p.index % 8]
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'pickaxe.blend'))
bpy.ops.export_scene.gltf(filepath=str(root / 'model.glb'), export_format='GLB', export_animations=False)
