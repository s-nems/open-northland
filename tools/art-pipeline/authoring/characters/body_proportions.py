import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix

from blender_common import scale_bone


def apply_body_proportions(config_file, yaw_degrees):
    config = json.loads(Path(config_file).read_text())
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
    for side in ['Left', 'Right']:
        for part in config['independentScale']:
            armature.data.bones[side + part].inherit_scale = 'NONE'
        for part, scale in config['boneScales'].items():
            if side + part not in armature.pose.bones:
                raise ValueError(f'Missing proportion bone: {side}{part}')
            scale_bone(side + part, scale)
    for obj in bpy.context.scene.objects:
        if obj.parent == armature and obj.parent_type == 'BONE':
            part = obj.parent_bone.removeprefix('Left').removeprefix('Right')
            if part in config['boneScales']:
                scale = config['boneScales'][part]
                obj.scale = tuple(obj.scale[i] / scale[i] for i in range(3))
    rotation = Matrix.Rotation(math.radians(yaw_degrees), 4, 'Z')
    squeeze = rotation @ Matrix.Diagonal((*config['bodyScale'], 1)) @ rotation.inverted()
    roots = [obj for obj in bpy.context.scene.objects
             if obj.parent is None and obj.type not in {'CAMERA', 'LIGHT'}]
    control = bpy.data.objects.new('BodyProportions', None)
    bpy.context.collection.objects.link(control)
    for obj in roots:
        world = obj.matrix_world.copy()
        obj.parent = control
        obj.matrix_world = world
    control.matrix_world = squeeze
    bpy.context.view_layer.update()
