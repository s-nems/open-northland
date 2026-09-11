import json
import math
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector


def attach_equipment(config_file, armature):
    config_path = Path(config_file).resolve()
    config = json.loads(config_path.read_text())
    bone = armature.pose.bones[config['bone']]
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str((config_path.parent / config['model']).resolve()))
    imported = set(bpy.context.scene.objects) - before
    meshes = [obj for obj in imported if obj.type == 'MESH']
    points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    scale = config['length'] / (high.z - low.z)
    origin = low + Vector(tuple((high[i] - low[i]) * config['grip_fraction'][i] for i in range(3)))
    rotation = Euler(tuple(math.radians(v) for v in config['rotation_degrees'])).to_matrix()
    unit = (armature.matrix_world @ bone.tail - armature.matrix_world @ bone.head).length / bone.length
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        for vertex in obj.data.vertices:
            point = world @ vertex.co
            if config.get('head_scale'):
                height = high.z - low.z
                phase = (point.z - low.z) / height
                blend = max(0.0, min(1.0, (phase - config['head_start_fraction']) / 0.04))
                blend = blend * blend * (3 - 2 * blend)
                center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2,
                                 low.z + height * config['head_center_fraction']))
                for axis, factor in enumerate(config['head_scale']):
                    point[axis] = center[axis] + (point[axis] - center[axis]) * (1 + (factor - 1) * blend)
            vertex.co = rotation @ ((point - origin) * scale)
        obj.parent = armature
        obj.parent_type = 'BONE'
        obj.parent_bone = config['bone']
        obj.matrix_parent_inverse = Matrix.Translation((0, -bone.bone.length, 0))
        obj.location = Vector(config['palm_offset']) / unit
        obj.scale = (1 / unit,) * 3
        obj.name = config['name']
    for obj in imported:
        if obj.type != 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
    from blender_common import unlit_materials
    unlit_materials()
    bpy.context.view_layer.update()
    return meshes
