"""Bake an authored wall strike onto the shared civilian rig in Blender."""
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / 'cycle.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str((ROOT / config['source']).resolve()))
scene = bpy.context.scene
scene.frame_set(1)
arm = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
base = {bone.name: bone.matrix_basis.copy() for bone in arm.pose.bones}
world = {bone.name: arm.matrix_world @ bone.matrix for bone in arm.pose.bones}
for obj in scene.objects:
    obj.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)

shoulder = world['RightArm'].translation
upper_length = (world['RightForeArm'].translation - shoulder).length
lower_length = (world['RightHand'].translation - world['RightForeArm'].translation).length


def aim(name, origin, end):
    initial = world[name]
    direction = initial.to_3x3().col[1].normalized()
    rotation = direction.rotation_difference((end - origin).normalized()).to_matrix()
    matrix = (rotation @ initial.to_3x3()).to_4x4()
    matrix.translation = origin
    arm.pose.bones[name].matrix = arm.matrix_world.inverted() @ matrix
    bpy.context.view_layer.update()


def pose(wrist, angle):
    wrist = Vector(wrist)
    ray = wrist - shoulder
    distance = ray.length
    if not abs(upper_length - lower_length) < distance < upper_length + lower_length:
        raise ValueError(f'Unreachable wrist: {tuple(wrist)}')
    direction = ray.normalized()
    pole = Vector(config['elbow_pole']) - shoulder
    pole = (pole - direction * pole.dot(direction)).normalized()
    along = (upper_length**2 - lower_length**2 + distance**2) / (2 * distance)
    elbow = shoulder + direction * along + pole * math.sqrt(upper_length**2 - along**2)
    aim('RightArm', shoulder, elbow)
    aim('RightForeArm', elbow, wrist)
    radians = math.radians(angle)
    # The socket handle points along hand-local -Z; the palm extends along +Y.
    matrix = Matrix(((1, 0, 0, 0),
                     (0, -math.cos(radians), -math.sin(radians), 0),
                     (0, math.sin(radians), -math.cos(radians), 0),
                     (0, 0, 0, 1)))
    matrix.translation = wrist
    matrix = matrix @ Matrix.Diagonal((*world['RightHand'].to_scale(), 1))
    arm.pose.bones['RightHand'].matrix = arm.matrix_world.inverted() @ matrix
    bpy.context.view_layer.update()
    actual = arm.matrix_world @ arm.pose.bones['RightHand'].head
    if (actual - wrist).length > 0.0001:
        raise ValueError('Wrist target was not reached')


scene.render.fps = config['fps']
scene.frame_start = 1
scene.frame_end = config['bake_frames'] + 1
keys = config['poses']
feet = []
for frame in range(config['bake_frames'] + 1):
    scene.frame_set(frame + 1)
    for name, matrix in base.items():
        arm.pose.bones[name].matrix_basis = matrix
    bpy.context.view_layer.update()
    first, second = next((a, b) for a, b in zip(keys, keys[1:]) if a['frame'] <= frame <= b['frame'])
    mix = (frame - first['frame']) / (second['frame'] - first['frame'])
    mix = mix * mix * (3 - 2 * mix)
    wrist = Vector(first['wrist']).lerp(Vector(second['wrist']), mix)
    angle = first['handle_back_degrees'] * (1 - mix) + second['handle_back_degrees'] * mix
    pose(wrist, angle)
    feet.append([tuple(arm.matrix_world @ arm.pose.bones[name].head)
                 for name in ('LeftFoot', 'RightFoot')])
    for bone in arm.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.keyframe_insert('location', frame=frame + 1)
        bone.keyframe_insert('rotation_quaternion', frame=frame + 1)
        bone.keyframe_insert('scale', frame=frame + 1)
if any((Vector(point) - Vector(start)).length > 0.00001
       for pair in feet for point, start in zip(pair, feet[0])):
    raise ValueError('Feet moved during the strike')
bpy.ops.export_scene.gltf(filepath=str(ROOT / config['output']), export_format='GLB',
                          export_animations=True, export_frame_range=True,
                          export_force_sampling=True)
print('Verified: reachable wrist at every frame; planted feet; closed authored cycle.')
