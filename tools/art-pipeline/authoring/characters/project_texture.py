import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from mathutils import Matrix
from blender_common import FACINGS, FACING_YAW, add_camera, add_common_args, base_colour_nodes, clip_range, evaluated_bounds, goto_frame, import_glb, sample_frames, set_yaw, setup_scene

BAKE_MARGIN_PX = 4
FILL_PASSES = 6
PAINT_ALPHA_MIN = 0.5


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    add_common_args(p)
    p.add_argument("--views", required=True)
    p.add_argument("--angle", type=float, default=15.0)
    p.add_argument("--texsize", type=int, default=1024)
    p.add_argument("--eps", type=float, default=0.03, help="depth tolerance in metres for a texel to count as visible")
    p.add_argument("--power", type=float, default=3.0, help="exponent on the head-on weight; higher favours the best view")
    p.add_argument("--view-selection", choices=["blend", "strongest"], default="blend")
    return p.parse_args(argv)


def pixels_of(image):
    w, h = image.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4)


def bake_map(meshes, bake_type, size, normal_space=None):
    image = bpy.data.images.new(f"bake_{bake_type}", size, size, alpha=True, float_buffer=True)
    # Start fully transparent, so alpha tells baked texels from the space between UV islands.
    image.pixels.foreach_set(np.zeros(size * size * 4, dtype=np.float32))
    for mesh in meshes:
        for mat in [slot.material for slot in mesh.material_slots if slot.material and slot.material.use_nodes]:
            node = mat.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = image
            mat.node_tree.nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    scene = bpy.context.scene
    scene.render.bake.margin = BAKE_MARGIN_PX
    scene.render.bake.use_clear = False
    kwargs = {"type": bake_type, "margin": BAKE_MARGIN_PX, "use_clear": False}
    if normal_space:
        kwargs["normal_space"] = normal_space
    bpy.ops.object.bake(**kwargs)
    return pixels_of(image)


def depth_material():
    """Every surface emits its distance along the view axis, so a float render of it is a depth map."""
    mat = bpy.data.materials.new("DepthOverride")
    mat.use_nodes = True
    nt = mat.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    camera = nt.nodes.new("ShaderNodeCameraData")
    emission = nt.nodes.new("ShaderNodeEmission")
    output = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(camera.outputs["View Z Depth"], emission.inputs["Color"])
    nt.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def render_depth(scene, out_dir, name):
    path = os.path.join(out_dir, f"depth_{name}.exr")
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path)
    px = pixels_of(image)
    bpy.data.images.remove(image)
    # Film transparency premultiplies the emitted depth by coverage; edge pixels are worth undoing that.
    alpha = px[:, :, 3]
    depth = np.where(alpha > 0.5, px[:, :, 0] / np.maximum(alpha, 1e-6), np.inf)
    return depth


def load_paint(path):
    image = bpy.data.images.load(path)
    image.colorspace_settings.name = "Non-Color"
    px = pixels_of(image)
    bpy.data.images.remove(image)
    return px


def fill_holes(rgb, valid, passes):
    """Spread painted texels into unpainted neighbours, so UV island borders do not show the fallback colour."""
    rgb = rgb.copy()
    valid = valid.copy()
    for _ in range(passes):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(valid.shape, dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                shifted = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
                shifted_valid = np.roll(np.roll(valid, dy, axis=0), dx, axis=1)
                acc += shifted * shifted_valid[:, :, None]
                cnt += shifted_valid
        grow = (~valid) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        valid = valid | grow
    return rgb, valid


def main():
    args = parse_args()
    scene = setup_scene(args.size)
    roots, meshes = import_glb(args.glb, args.head_scale, args.widen, args.upper_scale, args.limb_scale, args.foot_scale, args.hunch, args.deepen)
    if args.frame is not None:
        span = clip_range(list(scene.objects))
        frame = sample_frames(span[0], span[1], args.frames)[args.frame]
        goto_frame(scene, frame)
        print(f"POSE clip frame {frame:.2f} (sample {args.frame} of {args.frames})")
    lo, hi = evaluated_bounds(meshes)
    target = ((lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0)
    print(f"MODEL bounds x {lo[0]:.3f}..{hi[0]:.3f} z {lo[2]:.3f}..{hi[2]:.3f}")

    # The model's own texture, resampled to the target size, is the fallback for texels no view paints.
    base_nodes = base_colour_nodes()
    if not base_nodes:
        raise SystemExit("no base colour image to fall back on")
    base_image = base_nodes[0][1].image
    base_image.colorspace_settings.name = "Non-Color"
    base_full = pixels_of(base_image)[:, :, :3]
    rows = (np.arange(args.texsize) * base_full.shape[0]) // args.texsize
    cols = (np.arange(args.texsize) * base_full.shape[1]) // args.texsize
    base = base_full[rows][:, cols].copy()

    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.device = "CPU"
    positions = bake_map(meshes, "POSITION", args.texsize)
    normals = bake_map(meshes, "NORMAL", args.texsize, normal_space="OBJECT")
    baked = positions[:, :, 3] > 0.5
    pos = positions[:, :, :3].reshape(-1, 3).astype(np.float64)
    nrm = normals[:, :, :3].reshape(-1, 3).astype(np.float64) * 2.0 - 1.0
    world = np.array(meshes[0].matrix_world)
    span_local = pos[baked.reshape(-1)].max(axis=0) - pos[baked.reshape(-1)].min(axis=0)
    if span_local.max() > 2.0 * (hi[2] - lo[2]):
        # Object space: bring positions and normals into the world like the mesh object is.
        pos = pos @ world[:3, :3].T + world[:3, 3]
        nrm = nrm @ np.linalg.inv(world[:3, :3])
        print("BAKE object space, applied the mesh object's world matrix")
    else:
        print("BAKE world space")
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
    print(f"BAKE texels {int(baked.sum())} of {baked.size}, positions z {pos[baked.reshape(-1), 2].min():.3f}..{pos[baked.reshape(-1), 2].max():.3f}")

    scene.render.engine = "BLENDER_EEVEE"
    scene.view_layers[0].material_override = depth_material()
    cam = add_camera(args.angle, target)
    bpy.context.view_layer.update()
    cam_inv = np.array(cam.matrix_world.inverted())
    to_cam = np.array(cam.matrix_world.to_3x3() @ __import__("mathutils").Vector((0.0, 0.0, 1.0)))
    half = cam.data.ortho_scale / 2.0
    size = args.size
    os.makedirs(args.out, exist_ok=True)
    depth_dir = os.path.join(args.out, "depth")
    os.makedirs(depth_dir, exist_ok=True)

    samples = {}
    for facing in FACINGS:
        yaw = math.radians(FACING_YAW[facing])
        set_yaw(roots, FACING_YAW[facing])
        depth = render_depth(scene, depth_dir, facing)
        paint = load_paint(os.path.join(args.views, f"{facing}.png"))
        rot = np.array([[math.cos(yaw), -math.sin(yaw), 0.0], [math.sin(yaw), math.cos(yaw), 0.0], [0.0, 0.0, 1.0]])
        p = pos @ rot.T
        n = nrm @ rot.T
        pc = p @ cam_inv[:3, :3].T + cam_inv[:3, 3]
        px = (pc[:, 0] / half + 1.0) / 2.0 * size
        py_top = (1.0 - pc[:, 1] / half) / 2.0 * size
        d = -pc[:, 2]
        ix = np.clip(np.floor(px).astype(int), 0, size - 1)
        iy_bottom = np.clip(size - 1 - np.floor(py_top).astype(int), 0, size - 1)
        inside = (px >= 0) & (px < size) & (py_top >= 0) & (py_top < size) & baked.reshape(-1)
        visible = inside & (d <= depth[iy_bottom, ix] + args.eps)
        facing_weight = n @ to_cam
        alpha = paint[iy_bottom, ix, 3]
        weight = np.where(visible & (alpha >= PAINT_ALPHA_MIN), np.maximum(facing_weight, 0.0), 0.0) ** args.power
        samples[facing] = (weight.astype(np.float32), paint[iy_bottom, ix, :3])
        print(f"VIEW {facing}: visible {int(visible.sum())}, paints {int((weight > 0).sum())} texels")
    bpy.data.objects.remove(cam)
    scene.view_layers[0].material_override = None

    def write_texture(name, view_factor):
        total = np.zeros(pos.shape[0], dtype=np.float32)
        colour = np.zeros((pos.shape[0], 3), dtype=np.float32)
        for facing, (weight, rgb) in samples.items():
            w = weight * view_factor(facing)
            if args.view_selection == "strongest":
                better = w > total
                colour[better] = rgb[better] * w[better, None]
                total[better] = w[better]
            else:
                total += w
                colour += rgb * w[:, None]
        painted = total > 0
        colour[painted] /= total[painted][:, None]
        filled, valid = fill_holes(colour.reshape(args.texsize, args.texsize, 3), painted.reshape(args.texsize, args.texsize), FILL_PASSES)
        result = np.where(valid[:, :, None], filled, base)
        path = os.path.join(args.out, f"{name}.png")
        out = bpy.data.images.new(name, args.texsize, args.texsize, alpha=False)
        out.colorspace_settings.name = "Non-Color"
        rgba = np.concatenate([result, np.ones((args.texsize, args.texsize, 1), dtype=np.float32)], axis=2)
        out.pixels.foreach_set(rgba.astype(np.float32).ravel())
        out.filepath_raw = path
        out.file_format = "PNG"
        out.save()
        print(f"WROTE {path}: {int(painted.sum())} texels painted, {int(valid.sum())} after fill, {int((baked.reshape(-1) & ~valid.reshape(-1)).sum())} keep the base colour")

    write_texture("texture", lambda facing: 1.0)
    for target in FACINGS:
        def closeness(facing, target_yaw=FACING_YAW[target]):
            delta = math.radians(FACING_YAW[facing] - target_yaw)
            return max(0.0, math.cos(delta))
        write_texture(f"texture-{target}", closeness)


main()
