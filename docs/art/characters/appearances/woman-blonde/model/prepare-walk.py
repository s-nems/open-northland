"""Apply an approximate upright posture while retaining the source walk's keys and timing."""
import math
from pathlib import Path

import bpy
from mathutils import Quaternion

root = Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'walk.glb'))
arm = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
action = arm.animation_data.action
corrections = {'Spine01': -7, 'neck': -5}
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for name, degrees in corrections.items():
                path = f'pose.bones["{name}"].rotation_quaternion'
                curves = sorted((curve for curve in bag.fcurves if curve.data_path == path),
                                key=lambda curve: curve.array_index)
                if len(curves) != 4:
                    raise ValueError(f'Missing quaternion channels for {name}')
                keys = [list(curve.keyframe_points) for curve in curves]
                if len({len(points) for points in keys}) != 1:
                    raise ValueError(f'Mismatched quaternion keys for {name}')
                correction = Quaternion((1, 0, 0), math.radians(degrees))
                for points in zip(*keys):
                    if len({point.co.x for point in points}) != 1:
                        raise ValueError(f'Mismatched quaternion times for {name}')
                    rotation = Quaternion([point.co.y for point in points]) @ correction
                    for point, value in zip(points, rotation):
                        point.co.y = value
                for curve in curves:
                    curve.update()
bpy.ops.export_scene.gltf(filepath=str(root / 'walk-upright.glb'), export_format='GLB',
                         export_animations=True)
