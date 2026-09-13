import argparse
import hashlib
import json
from pathlib import Path
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from blender_common import FACING_YAW, ROOT_BONE, add_axe, add_camera, add_common_args, add_lights, apply_style, clip_range, evaluated_bounds, goto_frame, import_glb, render_to, sample_frames, set_yaw, setup_scene


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    add_common_args(p)
    p.add_argument("--facing", default="SW", choices=sorted(FACING_YAW))
    p.add_argument("--angle", type=float, default=35.0)
    p.add_argument("--range", default=None, help="clip frames <start>,<end> to sample instead of the whole clip")
    p.add_argument("--fix-root", action="store_true", help="keep the root bone's horizontal position at its first sampled frame")
    p.add_argument("--camera-cache", help="Shared camera receipt for appearances using the same clip and proportions")
    p.add_argument("--sample-phases", help="Comma-separated normalized clip phases in playback order")
    p.add_argument("--camera-reference", help="Read-only approved camera receipt, independent of pose selection")
    p.add_argument("--head-model", help="separate head GLB fitted to the civilian socket")
    p.add_argument("--head-config", help="head attachment JSON")
    p.add_argument("--body-proportions", help="Body scale profile applied after neutral head assembly")
    p.add_argument("--equipment", help="textured equipment attachment JSON")
    p.add_argument("--limb-texture", help="matching rigged base paint for exposed arm and hand regions")
    p.add_argument("--limb-occlusion", type=float, default=0.0, help="Contact shading strength on exposed limbs")
    p.add_argument("--shadow-only", action="store_true", help="Render the evaluated cast silhouette on flat ground")
    p.add_argument("--padding", type=int, default=0, help="Extra render pixels on each side at the calibrated pixel density")
    return p.parse_args(argv)


def root_travel(scene, frames):
    """Per sampled frame, the horizontal offset of the root bone from its position on the first sample."""
    armature = next(o for o in scene.objects if o.type == "ARMATURE")
    bone = armature.pose.bones[ROOT_BONE]
    heads = []
    for f in frames:
        goto_frame(scene, f)
        heads.append(armature.matrix_world @ bone.head)
    return armature, [(h.x - heads[0].x, h.y - heads[0].y) for h in heads]


def main():
    args = parse_args()
    if not 0 <= args.limb_occlusion <= 1:
        raise ValueError('Limb occlusion must be between zero and one')
    if args.padding < 0:
        raise ValueError('Render padding must be non-negative')
    scene = setup_scene(args.size + 2 * args.padding)
    roots, meshes = import_glb(args.glb, args.head_scale, args.widen, args.upper_scale, args.limb_scale, args.foot_scale, args.hunch, args.deepen)
    if args.prop == "axe":
        meshes += add_axe()
    apply_style(args)
    add_lights(args.sun, args.world)
    set_yaw(roots, FACING_YAW[args.facing])
    span = clip_range(list(scene.objects))
    if span is None:
        raise SystemExit("no animation found in the GLB")
    start, end = span
    if args.range:
        start, end = [float(v) for v in args.range.split(",")]
    frames = sample_frames(start, end, args.frames)
    if args.sample_phases:
        phases = [float(value) for value in args.sample_phases.split(',')]
        if len(phases) != args.frames or any(not 0 <= phase < 1 for phase in phases):
            raise ValueError('Sample phases must match frame count and lie in [0, 1)')
        frames = [start + (end-start)*phase for phase in phases]
    print(f"CLIP frames {start:g}..{end:g} fps {scene.render.fps} sampled {len(frames)}")
    # The travel is measured in world space with the facing's yaw already applied, so it is undone in world space.
    armature, travel = root_travel(scene, frames) if args.fix_root else (None, [(0.0, 0.0)] * len(frames))
    if args.fix_root:
        print(f"ROOT travel over the loop x {travel[-1][0]:.3f} y {travel[-1][1]:.3f} m, cancelled")
    base_location = armature.location.copy() if armature is not None else None

    def pose(i):
        goto_frame(scene, frames[i])
        if armature is not None:
            offset = Vector((travel[i][0], travel[i][1], 0.0))
            if armature.parent is not None:
                offset = armature.parent.matrix_world.inverted().to_3x3() @ offset
            armature.location = base_location - offset
            bpy.context.view_layer.update()

    cache_file = Path(args.camera_cache) if args.camera_cache else None
    signature = hashlib.sha256(Path(args.glb).read_bytes()).hexdigest() + json.dumps({
        'facing':args.facing,'frames':frames,'fix_root':args.fix_root,
        'proportions':[args.head_scale,args.widen,args.upper_scale,args.limb_scale,args.foot_scale,args.hunch,args.deepen],
        'prop':args.prop,
    },sort_keys=True)
    cached = json.loads(cache_file.read_text()) if cache_file and cache_file.exists() else None
    if args.camera_reference:
        target = json.loads(Path(args.camera_reference).read_text())['target']
    elif cached and cached['signature'] == signature:
        target = cached['target']
    else:
        lo = [float("inf")] * 3
        hi = [float("-inf")] * 3
        for i in range(len(frames)):
            pose(i)
            flo, fhi = evaluated_bounds(meshes)
            lo = [min(a, b) for a, b in zip(lo, flo)]
            hi = [max(a, b) for a, b in zip(hi, fhi)]
        target = [(lo[i] + hi[i])/2 for i in range(3)]
        if cache_file:
            cache_file.parent.mkdir(parents=True,exist_ok=True)
            temporary = cache_file.with_suffix(f'.{os.getpid()}.tmp')
            temporary.write_text(json.dumps({'signature':signature,'target':target},indent=2)+'\n')
            temporary.replace(cache_file)
    add_camera(args.angle, target)
    scene.camera.data.ortho_scale *= (args.size + 2 * args.padding) / args.size
    Path(args.out).mkdir(parents=True, exist_ok=True)
    (Path(args.out) / 'projection.json').write_text(json.dumps({'padding': args.padding}) + '\n')
    if args.head_model:
        bpy.context.view_layer.update()
        from head_variant import replace_head
        replace_head(args.head_model, args.head_config, args.toon, FACING_YAW[args.facing])
    if args.equipment:
        from equipment import attach_equipment
        arm = next(o for o in scene.objects if o.type == 'ARMATURE')
        attach_equipment(args.equipment, arm)
    if args.limb_texture:
        from limb_paint import restore_limb_paint
        restore_limb_paint(meshes, args.limb_texture, args.limb_occlusion)
    shadow = None
    if args.shadow_only:
        from ground_shadow import GroundShadow
        shadow = GroundShadow()
    for i, f in enumerate(frames):
        pose(i)
        if i == 0 and args.body_proportions:
            from body_proportions import apply_body_proportions
            apply_body_proportions(args.body_proportions, FACING_YAW[args.facing])
        if shadow is not None:
            shadow.update()
        render_to(os.path.join(args.out, f"f{i:02d}.png"))
        print(f"RENDER frame {i} at {f:.2f}")


main()
