import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / 'cycle.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / config['source']))
scene = bpy.context.scene
arm = next(obj for obj in scene.objects if obj.type == 'ARMATURE')


def position(name):
    return (arm.matrix_world @ arm.pose.bones[name].matrix).translation.copy()


def rotate(name, delta):
    bone = arm.pose.bones[name]
    world = arm.matrix_world @ bone.matrix
    origin = world.translation.copy()
    world = delta.to_matrix().to_4x4() @ world
    world.translation = origin
    bone.matrix = arm.matrix_world.inverted() @ world
    bpy.context.view_layer.update()


def fit_limb(upper, lower, tip, target, pole=None):
    shoulder, elbow, hand = map(position, (upper, lower, tip))
    first = (elbow - shoulder).length
    second = (hand - elbow).length
    axis = (target - shoulder).normalized()
    distance = min((target - shoulder).length, (first + second) * 0.995)
    along = (first * first - second * second + distance * distance) / (2 * distance)
    height = math.sqrt(max(0, first * first - along * along))
    bend = (pole if pole is not None else elbow) - shoulder
    bend = (bend - axis * bend.dot(axis)).normalized()
    goal = shoulder + axis * along + bend * height
    rotate(upper, (elbow - shoulder).rotation_difference(goal - shoulder))
    rotate(lower, (position(tip) - position(lower)).rotation_difference(target - position(lower)))


start, end = config['source_frames']
count = config['bake_frames']
poses = []
for index in range(count + 1):
    frame = start + (end - start) * index / count
    scene.frame_set(int(frame), subframe=frame % 1)
    poses.append({bone.name: bone.matrix_basis.decompose() for bone in arm.pose.bones})
for obj in scene.objects:
    obj.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
scene.render.fps = config['fps']
scene.frame_start = 1
scene.frame_end = count + 1
identity = Quaternion((1, 0, 0, 0))
feet = None
for index, pose in enumerate(poses):
    scene.frame_set(index + 1)
    phase = index / count
    fraction = config['seam_blend_fraction']
    seam = max(0, (phase - (1 - fraction)) / fraction)
    seam = seam * seam * (3 - 2 * seam)
    for bone in arm.pose.bones:
        location, rotation, scale = pose[bone.name]
        first_location, first_rotation, first_scale = poses[0][bone.name]
        last_location, last_rotation, last_scale = poses[-1][bone.name]
        bone.location = location - (last_location - first_location) * phase
        bone.rotation_mode = 'QUATERNION'
        correction = last_rotation.rotation_difference(first_rotation)
        bone.rotation_quaternion = rotation @ identity.slerp(correction, seam)
        bone.scale = scale - (last_scale - first_scale) * phase
    bpy.context.view_layer.update()
    if feet is None:
        feet = {side: (position(side + 'Foot'),
                       (arm.matrix_world @ arm.pose.bones[side + 'Foot'].matrix).to_quaternion())
                for side in ('Left', 'Right')}
    for side, (target, orientation) in feet.items():
        fit_limb(side + 'UpLeg', side + 'Leg', side + 'Foot', target)
        current = (arm.matrix_world @ arm.pose.bones[side + 'Foot'].matrix).to_quaternion()
        rotate(side + 'Foot', orientation @ current.inverted())
    fit_limb('LeftArm', 'LeftForeArm', 'LeftHand',
             Vector(config['wall_hand']), Vector(config['wall_elbow_pole']))
    # The wall normal is -Y; the supporting fingers point upward along +Z.
    palm = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_quaternion()
    current = (arm.matrix_world @ arm.pose.bones['LeftHand'].matrix).to_quaternion()
    rotate('LeftHand', palm @ current.inverted())
    grip = (arm.matrix_world @ arm.pose.bones['RightHand'].matrix).to_quaternion()
    fit_limb('RightArm', 'RightForeArm', 'RightHand', position('RightHand'),
             position('RightArm') + Vector(config['hammer_elbow_direction']))
    current = (arm.matrix_world @ arm.pose.bones['RightHand'].matrix).to_quaternion()
    rotate('RightHand', grip @ current.inverted())
    for bone in arm.pose.bones:
        for channel in ('location', 'rotation_quaternion', 'scale'):
            bone.keyframe_insert(channel, frame=index + 1)
bpy.ops.export_scene.gltf(filepath=str(ROOT / config['output']), export_format='GLB',
                          export_animations=True, export_frame_range=True,
                          export_force_sampling=True)
print('Baked generated motion with a loop seam and fixed palm/ankle contacts.')
