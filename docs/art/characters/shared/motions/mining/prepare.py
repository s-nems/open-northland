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
arm = next((obj for obj in scene.objects if obj.type == 'ARMATURE'))


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
    (shoulder, elbow, hand) = map(position, (upper, lower, tip))
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


def interpolate(keys, phase):
    for (a, b) in zip(keys, keys[1:]):
        if phase <= b[0]:
            t = (phase - a[0]) / (b[0] - a[0])
            return [Vector(x).lerp(Vector(y), t) if isinstance(x, list) else x + (y - x) * t for (x, y) in zip(a[1:], b[1:])]
    return keys[-1][1:]


count = config['bake_frames']
poses = []
for index in range(count + 1):
    frame = interpolate(config['motion_phases'], index / count)[0]
    scene.frame_set(int(frame), subframe=frame % 1)
    poses.append({b.name: b.matrix_basis.decompose() for b in arm.pose.bones})
for obj in scene.objects:
    obj.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
scene.render.fps = config['fps']
scene.frame_start = 1
scene.frame_end = count + 1
identity = Quaternion((1, 0, 0, 0))
feet = None
for (index, pose) in enumerate(poses):
    scene.frame_set(index + 1)
    phase = index / count
    seam = max(0, (phase - (1 - config['seam_blend_fraction'])) / config['seam_blend_fraction'])
    seam = seam * seam * (3 - 2 * seam)
    for bone in arm.pose.bones:
        (loc, rot, scale) = pose[bone.name]
        first = poses[0][bone.name]
        last = poses[-1][bone.name]
        bone.location = loc - (last[0] - first[0]) * phase
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = rot @ identity.slerp(last[1].rotation_difference(first[1]), seam)
        bone.scale = scale - (last[2] - first[2]) * phase
    bpy.context.view_layer.update()
    if feet is None:
        feet = {side: (position(side + 'Foot'), (arm.matrix_world @ arm.pose.bones[side + 'Foot'].matrix).to_quaternion()) for side in ('Left', 'Right')}
    hop = 0
    torso = ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head']
    orientations = {}
    for name in torso:
        world = arm.matrix_world @ arm.pose.bones[name].matrix
        axis = world.to_quaternion() @ Vector((0, 1, 0))
        pitch = math.atan2(-axis.y, axis.z)
        if name != 'Hips':
            pitch *= 0.65 if name != 'Head' else 0.85
        if name == 'Head':
            pitch += 0.30 * max(0, 1 - abs(phase - 0.3125) / 0.18)
        y = Vector((0, -math.sin(pitch), math.cos(pitch)))
        x = Vector((1, 0, 0))
        orientations[name] = Matrix((x, y, x.cross(y))).transposed().to_quaternion()
    for name in torso:
        current = (arm.matrix_world @ arm.pose.bones[name].matrix).to_quaternion()
        rotate(name, orientations[name] @ current.inverted())
    root = arm.pose.bones['Hips']
    root.location.x = poses[0]['Hips'][0].x
    root.location += arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, 0.06))
    bpy.context.view_layer.update()
    lower_by = 0.0
    for side, (target, _) in feet.items():
        hip, knee, ankle = map(position, (side + 'UpLeg', side + 'Leg', side + 'Foot'))
        reach = ((knee - hip).length + (ankle - knee).length) * 0.99
        ground = target + Vector((0, 0, hop))
        horizontal = (hip.x - ground.x) ** 2 + (hip.y - ground.y) ** 2
        height = math.sqrt(max(0, reach ** 2 - horizontal))
        lower_by = max(lower_by, hip.z - ground.z - height)
    root.location -= arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, lower_by))
    bpy.context.view_layer.update()
    for (side, (target, orientation)) in feet.items():
        fit_limb(side + 'UpLeg', side + 'Leg', side + 'Foot', target + Vector((0, 0, hop)))
        current = (arm.matrix_world @ arm.pose.bones[side + 'Foot'].matrix).to_quaternion()
        rotate(side + 'Foot', orientation @ current.inverted())
    (grip, axis) = interpolate(config['tool_keys'], phase)
    for a, b in zip(config['tool_keys'], config['tool_keys'][1:]):
        if phase <= b[0]:
            t = (phase - a[0]) / (b[0] - a[0])
            angle = (1 - t) * math.atan2(a[2][1], a[2][2]) + t * math.atan2(b[2][1], b[2][2])
            axis = Vector((0, math.sin(angle), math.cos(angle)))
            break
    lift = max(0, min(1 - abs(phase - 0.3125) / 0.30, (0.375 - phase) / 0.03))
    for side in ('Left', 'Right'):
        clavicle = position(side + 'Shoulder')
        upper = position(side + 'Arm')
        rotate(side + 'Shoulder', (upper - clavicle).rotation_difference(upper + Vector((0, -0.10 * lift, 0.13 * lift)) - clavicle))
    for side in ('Left', 'Right'):
        bone = arm.pose.bones[side + 'Arm']
        world = arm.matrix_world @ bone.matrix
        back = 0.22 * max(0, 1 - abs(phase - 0.3125) / 0.025)
        world.translation += Vector((0.13 if side == 'Left' else -0.13, 0.05, 0.23)) * lift + Vector((0, back, 0))
        bone.matrix = arm.matrix_world.inverted() @ world
        bpy.context.view_layer.update()
    grip.x += (position('LeftArm').x + position('RightArm').x) * 0.5
    # Local Z follows the shaft; local Y follows the fingers across the grip.
    x = Vector((1, 0, 0))
    y = axis.cross(x).normalized()
    x = y.cross(axis).normalized()
    orientation = Matrix((x, y, axis)).transposed().to_quaternion()
    authored_grip = grip.copy()
    for _ in range(12 if phase >= 0.375 else 0):
        for side, offset in [('Right', 0), ('Left', 0.16)]:
            palm = orientation if side == 'Right' else orientation @ Quaternion((0, 1, 0), math.pi)
            shoulder, elbow, wrist = map(position, (side + 'Arm', side + 'ForeArm', side + 'Hand'))
            reach = ((elbow - shoulder).length + (wrist - elbow).length) * 0.97
            desired = grip + axis * offset - palm @ Vector((0, 0.065, 0))
            delta = desired - shoulder
            if delta.length > reach:
                grip -= delta.normalized() * (delta.length - reach)
    grip = authored_grip.lerp(grip, min(1, (1 - phase) / 0.1875))
    for (side, center) in [('Right', grip), ('Left', grip + axis * 0.16)]:
        palm = orientation if side == 'Right' else orientation @ Quaternion((0, 1, 0), math.pi)
        wrist = center - palm @ Vector((0, 0.065, 0))
        fit_limb(side + 'Arm', side + 'ForeArm', side + 'Hand', wrist, position(side + 'Arm') + Vector((0.8 if side == 'Left' else -0.8, -0.45, 0.05)))
        current = (arm.matrix_world @ arm.pose.bones[side + 'Hand'].matrix).to_quaternion()
        rotate(side + 'Hand', palm @ current.inverted())
    for bone in arm.pose.bones:
        for channel in ('location', 'rotation_quaternion', 'scale'):
            bone.keyframe_insert(channel, frame=index + 1)
bpy.ops.export_scene.gltf(filepath=str(ROOT / config['output']), export_format='GLB', export_animations=True, export_frame_range=True, export_force_sampling=True)
print('Baked generated mining loop with sagittal torso motion and two-hand tool contacts.')
