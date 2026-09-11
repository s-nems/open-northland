from blender_materials import apply_style, base_colour_nodes, toonify_materials, unlit_materials
import math
import os

import bpy
from mathutils import Matrix

# Facing names in the original atlas storage order (one full turn, starting at SW).
FACINGS = ["SW", "W", "NW", "NE", "E", "SE", "S", "N"]
# Object rotation about Z (degrees) that turns a -Y-facing model toward each screen facing.
FACING_YAW = {"S": 0, "SE": 45, "E": 90, "NE": 135, "N": 180, "NW": 225, "W": 270, "SW": 315}
ORTHO_SCALE = 2.6
CAMERA_DISTANCE = 10.0
DEFAULT_SUN_STRENGTH = 3.0
DEFAULT_WORLD_STRENGTH = 0.35
# Meshy clip exports carry a bounding icosphere (42 vertices); anything this small is a helper, not the character.
HELPER_MAX_VERTS = 100
# Meshy rig bones used as proportion controls after generation: the skull, and the chest bone that parents
# both shoulders and the neck, so widening it widens everything above the belt.
HEAD_BONE = "Head"
CHEST_BONE = "Spine"
ROOT_BONE = "Hips"
LIMB_BONES = ["LeftArm", "LeftForeArm", "RightArm", "RightForeArm", "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"]
FOOT_BONES = ["LeftFoot", "RightFoot"]
# Hunch: the mid-spine bone leans forward and the head leans back by the same angle, so the face stays level.
HUNCH_BONE = "Spine01"
HUNCH_COUNTER_BONE = "Head"
# Woodcutter's axe prop on the right hand. The handle crosses the palm along the hand bone's local Z with the
# head on the thumb side (-Z) and the blade toward the knuckles (-X); the hand grips near the butt end.
AXE_BONE = "RightHand"
AXE_GRIP_FROM_WRIST_M = 0.08
AXE_HANDLE_M = 1.1
AXE_GRIP_FROM_BUTT = 0.15
AXE_HANDLE_RADIUS_M = 0.035
AXE_HEAD_M = (0.3, 0.08, 0.2)
AXE_HEAD_OVERHANG_M = 0.05
# Linear display colours for the synthetic axe.
AXE_HANDLE_COLOR = (0.09, 0.045, 0.02, 1.0)
AXE_HEAD_COLOR = (0.05, 0.055, 0.065, 1.0)
PROPS = ["axe"]


def add_common_args(parser):
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--sun", type=float, default=DEFAULT_SUN_STRENGTH, help="sun strength, 0 disables the sun")
    parser.add_argument("--world", type=float, default=DEFAULT_WORLD_STRENGTH, help="white world light strength")
    parser.add_argument("--toon", type=int, default=0, help="number of shading bands, 0 keeps smooth shading")
    parser.add_argument("--freestyle", action="store_true", help="draw crease lines between garments and limbs")
    parser.add_argument("--head-scale", type=float, default=1.0, help="scale of the head bone, rigged models only")
    parser.add_argument("--widen", type=float, default=1.0, help="horizontal scale of the whole figure, height unchanged")
    parser.add_argument("--deepen", type=float, default=1.0, help="front-to-back scale of the whole figure, width and height unchanged")
    parser.add_argument("--upper-scale", type=float, default=1.0, help="thickness scale of the chest bone and everything above it, rigged models only")
    parser.add_argument("--limb-scale", type=float, default=1.0, help="thickness scale of the arm and leg bones, length unchanged, rigged models only")
    parser.add_argument("--foot-scale", type=float, default=1.0, help="uniform scale of the foot bones (boots), rigged models only")
    parser.add_argument("--hunch", type=float, default=0.0, help="degrees the upper body leans forward, head kept level, rigged models only")
    parser.add_argument("--prop", choices=PROPS, default=None, help="tool mesh attached to the rig's right hand")
    parser.add_argument("--texture", default=None, help="PNG that replaces every material's base colour image")
    parser.add_argument("--unlit", action="store_true", help="show the base colour as is, no lighting (for textures with light painted in)")
    parser.add_argument("--frame", type=int, default=None, help="for clip GLBs: index of the sampled clip frame to pose the static renders on")
    parser.add_argument("--frames", type=int, default=12, help="number of evenly spaced samples the clip is divided into")


def setup_scene(size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    return scene


def add_lights(sun_strength, world_strength):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = world_strength
    if sun_strength <= 0:
        return None
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = sun_strength
    sun_data.angle = math.radians(2.0)
    sun = bpy.data.objects.new("Sun", sun_data)
    scene.collection.objects.link(sun)
    # Light from the upper left, slightly in front of the model (camera side is -Y).
    sun.rotation_euler = (math.radians(50), 0.0, math.radians(-35))
    return sun


def add_camera(elevation_deg, target):
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ORTHO_SCALE
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    theta = math.radians(elevation_deg)
    tx, ty, tz = target
    cam.location = (tx, ty - CAMERA_DISTANCE * math.cos(theta), tz + CAMERA_DISTANCE * math.sin(theta))
    cam.rotation_euler = (math.radians(90.0) - theta, 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


def scale_bone(name, scale):
    """Force a bone's local scale (x, y, z) through a constraint, so the clip's own scale keys cannot undo it."""
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not armatures:
        print("BONE-SCALE skipped: no armature in the file")
        return
    for arm in armatures:
        bone = arm.pose.bones.get(name)
        if bone is None:
            print("BONE-SCALE skipped: no bone", name, "in", arm.name)
            continue
        limit = bone.constraints.new("LIMIT_SCALE")
        limit.owner_space = "LOCAL"
        for axis, value in zip("xyz", scale):
            setattr(limit, "use_min_" + axis, True)
            setattr(limit, "use_max_" + axis, True)
            setattr(limit, "min_" + axis, value)
            setattr(limit, "max_" + axis, value)
        print(f"BONE-SCALE {arm.name}.{name} x{scale[0]:g} y{scale[1]:g} z{scale[2]:g}")


def lean_bone(name, degrees):
    """Add a rotation about a bone's local X (its sideways axis) on top of whatever the clip animates."""
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not armatures:
        print("BONE-LEAN skipped: no armature in the file")
        return
    target = bpy.data.objects.new(f"Lean{name}", None)
    target.rotation_mode = "XYZ"
    target.rotation_euler = (math.radians(degrees), 0.0, 0.0)
    bpy.context.scene.collection.objects.link(target)
    for arm in armatures:
        bone = arm.pose.bones.get(name)
        if bone is None:
            print("BONE-LEAN skipped: no bone", name, "in", arm.name)
            continue
        copy = bone.constraints.new("COPY_ROTATION")
        copy.target = target
        copy.mix_mode = "AFTER"
        copy.owner_space = "LOCAL"
        copy.target_space = "LOCAL"
        print(f"BONE-LEAN {arm.name}.{name} {degrees:g} deg")


def import_glb(path, head_scale=1.0, widen=1.0, upper_scale=1.0, limb_scale=1.0, foot_scale=1.0, hunch=0.0, deepen=1.0):
    """Import a GLB and return (root objects, mesh objects). Roots get XYZ rotation so rotation_euler works."""
    bpy.ops.import_scene.gltf(filepath=path)
    if head_scale != 1.0:
        scale_bone(HEAD_BONE, (head_scale, head_scale, head_scale))
    if upper_scale != 1.0:
        # A bone's local Y runs along the bone, so X and Z are its thickness.
        scale_bone(CHEST_BONE, (upper_scale, 1.0, upper_scale))
    if limb_scale != 1.0:
        for name in LIMB_BONES:
            scale_bone(name, (limb_scale, 1.0, limb_scale))
    if foot_scale != 1.0:
        for name in FOOT_BONES:
            scale_bone(name, (foot_scale, foot_scale, foot_scale))
    if hunch != 0.0:
        lean_bone(HUNCH_BONE, hunch)
        lean_bone(HUNCH_COUNTER_BONE, hunch)
    for o in [o for o in bpy.context.scene.objects if o.type == "MESH" and len(o.data.vertices) <= HELPER_MAX_VERTS]:
        print("DROP helper mesh", o.name, len(o.data.vertices), "verts")
        bpy.data.objects.remove(o)
    objects = list(bpy.context.scene.objects)
    roots = [o for o in objects if o.parent is None and o.type != "LIGHT" and o.type != "CAMERA"]
    meshes = [o for o in objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("no mesh in " + path)
    for o in roots:
        # The glTF importer leaves objects in quaternion mode, where rotation_euler is ignored.
        o.rotation_mode = "XYZ"
        if widen != 1.0 or deepen != 1.0:
            # Multiply, because the importer's own unit scale lives in the root's scale. The model faces -Y, so Y is depth.
            o.scale = (o.scale.x * widen, o.scale.y * widen * deepen, o.scale.z)
    return roots, meshes


def flat_material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    return mat


def add_axe():
    """Attach the axe to the right hand bone; returns its mesh objects so they count in the clip bounds."""
    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    bone = arm.pose.bones.get(AXE_BONE) if arm is not None else None
    if bone is None:
        raise SystemExit(f"no bone {AXE_BONE} for the axe prop")
    bpy.context.view_layer.update()
    # Metres per bone-space unit, measured on the bone itself so every parent's scale is included.
    unit = (arm.matrix_world @ bone.tail - arm.matrix_world @ bone.head).length / bone.length
    handle_centre = AXE_HANDLE_M * (AXE_GRIP_FROM_BUTT - 0.5)
    head_centre = -AXE_HANDLE_M * (1.0 - AXE_GRIP_FROM_BUTT) + AXE_HEAD_M[2] / 2.0
    bpy.ops.mesh.primitive_cylinder_add(radius=AXE_HANDLE_RADIUS_M, depth=AXE_HANDLE_M, location=(0.0, 0.0, 0.0))
    handle = bpy.context.active_object
    handle.name = "AxeHandle"
    handle.data.materials.append(flat_material("AxeHandle", AXE_HANDLE_COLOR))
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
    head = bpy.context.active_object
    head.name = "AxeHead"
    head.data.materials.append(flat_material("AxeHead", AXE_HEAD_COLOR))
    placements = [
        (handle, (1.0, 1.0, 1.0), (0.0, AXE_GRIP_FROM_WRIST_M, handle_centre)),
        (head, AXE_HEAD_M, (AXE_HEAD_OVERHANG_M - AXE_HEAD_M[0] / 2.0, AXE_GRIP_FROM_WRIST_M, head_centre)),
    ]
    for obj, size, offset in placements:
        obj.parent = arm
        obj.parent_type = "BONE"
        obj.parent_bone = AXE_BONE
        # Bone parenting anchors at the tail, a rest length along the bone; step back to the wrist. The Meshy rig's
        # hand tails are far off the mesh, so the palm is a fixed distance from the wrist, not a share of the bone.
        obj.matrix_parent_inverse = Matrix.Translation((0.0, -bone.bone.length, 0.0))
        obj.rotation_mode = "XYZ"
        obj.scale = tuple(v / unit for v in size)
        obj.location = tuple(v / unit for v in offset)
    print(f"PROP axe on {arm.name}.{AXE_BONE}, {AXE_HANDLE_M:g} m handle")
    return [handle, head]


def set_yaw(roots, degrees):
    for o in roots:
        if o.type == "EMPTY":
            continue
        o.rotation_euler = (0.0, 0.0, math.radians(degrees))


def clip_range(objects):
    """Frame range of the imported clip, from the first action found on any object; None for a static GLB."""
    for o in objects:
        ad = o.animation_data
        if ad is None:
            continue
        if ad.action is not None:
            return ad.action.frame_range
        for track in ad.nla_tracks:
            for strip in track.strips:
                return (strip.frame_start, strip.frame_end)
    return None


def sample_frames(start, end, count):
    """Evenly spaced clip frames with the last one excluded, since a loop's end equals its start."""
    span = end - start
    return [start + span * i / count for i in range(count)]


def goto_frame(scene, frame):
    whole = int(frame)
    scene.frame_set(whole, subframe=frame - whole)


def evaluated_bounds(meshes):
    """World-space (min, max) of the evaluated (deformed) meshes at the current frame."""
    dg = bpy.context.evaluated_depsgraph_get()
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for mesh in meshes:
        ev = mesh.evaluated_get(dg)
        mat = ev.matrix_world
        for v in ev.data.vertices:
            p = mat @ v.co
            for i in range(3):
                lo[i] = min(lo[i], p[i])
                hi[i] = max(hi[i], p[i])
    return lo, hi


def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
