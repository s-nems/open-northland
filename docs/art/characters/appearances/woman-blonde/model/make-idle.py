import math
from pathlib import Path

import bpy
from mathutils import Quaternion

root = Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'idle.glb'))
scene = bpy.context.scene
arm = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
start = arm.animation_data.action.frame_range[0]
scene.frame_set(int(start), subframe=start-int(start))
base = {bone.name: bone.matrix_basis.copy() for bone in arm.pose.bones}
for obj in scene.objects:
    obj.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
scene.render.fps = 24
scene.frame_start, scene.frame_end = 1, 97
for frame in range(1, 98):
    phase = (frame-1)/96
    breath = math.sin(math.tau*phase)
    glance = math.sin(math.pi*(phase-.25)/.5)**2 if .25 < phase < .75 else 0
    for bone in arm.pose.bones:
        bone.matrix_basis = base[bone.name]
        bone.rotation_mode = 'QUATERNION'
        if bone.name == 'Spine':
            bone.rotation_quaternion @= Quaternion((1,0,0), math.radians(.65*breath))
        if bone.name == 'Head':
            bone.rotation_quaternion @= Quaternion((0,1,0), math.radians(12*glance))
        for channel in ('location','rotation_quaternion','scale'):
            bone.keyframe_insert(data_path=channel, frame=frame)
scene.frame_set(1)
bpy.ops.export_scene.gltf(filepath=str(root / 'idle-relaxed.glb'), export_format='GLB',
    export_animations=True, export_frame_range=True)
