import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from blender_common import FACINGS, FACING_YAW, add_axe, add_camera, add_common_args, add_lights, apply_style, clip_range, evaluated_bounds, goto_frame, import_glb, render_to, sample_frames, set_yaw, setup_scene


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    add_common_args(p)
    p.add_argument("--angles", default="35,40")
    return p.parse_args(argv)


def main():
    args = parse_args()
    setup_scene(args.size)
    roots, meshes = import_glb(args.glb, args.head_scale, args.widen, args.upper_scale, args.limb_scale, args.foot_scale, args.hunch, args.deepen)
    if args.prop == "axe":
        meshes += add_axe()
    apply_style(args)
    add_lights(args.sun, args.world)
    if args.frame is not None:
        span = clip_range(list(bpy.context.scene.objects))
        if span is None:
            raise SystemExit("--frame given but the GLB has no animation")
        frame = sample_frames(span[0], span[1], args.frames)[args.frame]
        goto_frame(bpy.context.scene, frame)
        print(f"POSE clip frame {frame:.2f} (sample {args.frame} of {args.frames})")
    lo, hi = evaluated_bounds(meshes)
    target = ((lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0)
    print(f"MODEL z-range {lo[2]:.3f}..{hi[2]:.3f} height {hi[2] - lo[2]:.3f}")
    for angle in [float(a) for a in args.angles.split(",")]:
        cam = add_camera(angle, target)
        for facing in FACINGS:
            set_yaw(roots, FACING_YAW[facing])
            render_to(os.path.join(args.out, f"{angle:g}deg", f"{facing}.png"))
            print(f"RENDER {angle:g} {facing}")
        bpy.data.objects.remove(cam)


main()
