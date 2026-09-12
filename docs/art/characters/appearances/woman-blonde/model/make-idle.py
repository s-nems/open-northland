import json
import math
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

root = Path(__file__).resolve().parent
config = json.loads((root / 'idle-relaxed.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / config['source']))
scene = bpy.context.scene
source_objects = set(scene.objects)
source = next(obj for obj in source_objects if obj.type == 'ARMATURE')
start, end = source.animation_data.action.frame_range
bpy.ops.import_scene.gltf(filepath=str(root / 'rigged.glb'))
arm = next(obj for obj in scene.objects if obj not in source_objects and obj.type == 'ARMATURE')
for name in arm.pose.bones.keys():
    if name not in source.pose.bones:
        raise ValueError(f'Missing motion bone: {name}')
    difference = max(abs(source.data.bones[name].matrix_local[i][j] - arm.data.bones[name].matrix_local[i][j])
                     for i in range(4) for j in range(4))
    if difference > .001:
        raise ValueError(f'Motion rest rig does not match the body: {name}')
count = config['frames'] - 1
poses = []
for index in range(count + 1):
    frame = start + (end - start) * index / count
    scene.frame_set(int(frame), subframe=frame % 1)
    poses.append({bone.name: bone.matrix_basis.decompose() for bone in source.pose.bones})
for obj in source_objects:
    bpy.data.objects.remove(obj, do_unlink=True)
for obj in scene.objects:
    obj.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
scene.render.fps = config['fps']
scene.frame_start, scene.frame_end = 1, count + 1


def position(name):
    return (arm.matrix_world @ arm.pose.bones[name].matrix).translation.copy()


def rotate(name, rotation):
    bone = arm.pose.bones[name]
    matrix = arm.matrix_world @ bone.matrix
    origin = matrix.translation.copy()
    matrix = rotation.to_matrix().to_4x4() @ matrix
    matrix.translation = origin
    bone.matrix = arm.matrix_world.inverted() @ matrix
    bpy.context.view_layer.update()


def plant_foot(side, target, orientation):
    upper, lower, tip = [side + name for name in ('UpLeg', 'Leg', 'Foot')]
    hip, knee, ankle = map(position, (upper, lower, tip))
    first, second = (knee - hip).length, (ankle - knee).length
    axis = (target - hip).normalized()
    distance = min((target - hip).length, (first + second) * .999)
    along = (first * first - second * second + distance * distance) / (2 * distance)
    height = math.sqrt(max(0, first * first - along * along))
    bend = knee - hip
    bend = (bend - axis * bend.dot(axis)).normalized()
    goal = hip + axis * along + bend * height
    rotate(upper, (knee - hip).rotation_difference(goal - hip))
    rotate(lower, (position(tip) - position(lower)).rotation_difference(target - position(lower)))
    current = (arm.matrix_world @ arm.pose.bones[tip].matrix).to_quaternion()
    rotate(tip, orientation @ current.inverted())


feet = None
for index, pose in enumerate(poses):
    scene.frame_set(index + 1)
    phase = index / count
    fraction = config['returnBlendFraction']
    blend = max(0, (phase - (1 - fraction)) / fraction)
    blend = blend * blend * (3 - 2 * blend)
    for bone in arm.pose.bones:
        location, rotation, scale = pose[bone.name]
        first_location, first_rotation, first_scale = poses[0][bone.name]
        bone.location = location.lerp(first_location, blend)
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = rotation.slerp(first_rotation, blend)
        bone.scale = scale.lerp(first_scale, blend)
    bpy.context.view_layer.update()
    neck = arm.pose.bones['neck']
    neck.rotation_quaternion = neck.rotation_quaternion @ Quaternion(
        (1, 0, 0), math.radians(config['neckPitchDegrees']))
    bpy.context.view_layer.update()
    matrix = arm.matrix_world @ neck.matrix
    matrix.translation += Vector(config['neckOffsetMeters'])
    neck.matrix = arm.matrix_world.inverted() @ matrix
    bpy.context.view_layer.update()
    if feet is None:
        feet = {side: (position(side + 'Foot'),
                       (arm.matrix_world @ arm.pose.bones[side + 'Foot'].matrix).to_quaternion())
                for side in ('Left', 'Right')}
    for side, (target, orientation) in feet.items():
        plant_foot(side, target, orientation)
    for bone in arm.pose.bones:
        for channel in ('location', 'rotation_quaternion', 'scale'):
            bone.keyframe_insert(data_path=channel, frame=index + 1)
scene.frame_set(1)
bpy.ops.export_scene.gltf(filepath=str(root / 'idle-relaxed.glb'), export_format='GLB',
                         export_animations=True, export_frame_range=True)
