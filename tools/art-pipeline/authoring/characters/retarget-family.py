import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def main():
    p = argparse.ArgumentParser()
    p.add_argument('source', type=Path)
    p.add_argument('target', type=Path)
    p.add_argument('output', type=Path)
    args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    source_objects = set(bpy.context.scene.objects)
    source = next(o for o in source_objects if o.type == 'ARMATURE')
    action = source.animation_data.action
    start, end = action.frame_range
    bpy.ops.import_scene.gltf(filepath=str(args.target.resolve()))
    target_objects = set(bpy.context.scene.objects) - source_objects
    target = next(o for o in target_objects if o.type == 'ARMATURE')
    missing = set(target.pose.bones.keys()) - set(source.pose.bones.keys())
    if missing:
        raise ValueError(f'Missing source bones: {missing}')
    target.animation_data_clear()
    target.animation_data_create()
    ratio = target.data.bones['Hips'].head_local.z / source.data.bones['Hips'].head_local.z
    scene = bpy.context.scene
    scene.render.fps = 24
    samples = round(end - start) + 1
    for frame in range(samples + 1):
        t = start + (end - start) * frame / samples
        scene.frame_set(int(t), subframe=t-int(t))
        for bone in target.pose.bones:
            src = source.pose.bones[bone.name]
            rotation = src.matrix.to_quaternion() @ src.bone.matrix_local.to_quaternion().inverted() @ bone.bone.matrix_local.to_quaternion()
            if bone.parent:
                offset = bone.parent.bone.matrix_local.inverted() @ bone.bone.head_local
                location = bone.parent.matrix @ offset
            else:
                location = bone.bone.head_local + (src.head-src.bone.head_local)*ratio
            bone.matrix = Matrix.LocRotScale(location, rotation, Vector((1, 1, 1)))
            bpy.context.view_layer.update()
            bone.rotation_mode = 'QUATERNION'
            for channel in ['location', 'rotation_quaternion', 'scale']:
                bone.keyframe_insert(channel, frame=1+frame)
    for obj in source_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    scene.frame_start, scene.frame_end = 1, samples+1
    scene.frame_set(1)
    bpy.ops.export_scene.gltf(filepath=str(args.output.resolve()), export_format='GLB', export_animations=True, export_frame_range=True)
    args.output.with_suffix('.json').write_text(json.dumps({'source':str(args.source),'target':str(args.target),'method':'world rest-rotation deltas with target segment lengths; visual approximation','duration':samples/24,'frames':samples+1},indent=2)+'\n')


main()
