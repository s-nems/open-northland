"""Author a separate timber skeleton in the farm's fixed orthographic view."""

import bpy, math, json, random, sys
from pathlib import Path
from mathutils import Vector

R = Path(__file__).resolve().parent
sys.path.insert(0, str(R))
from site_details import add_site

random.seed(12)
bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
s.render.engine = "CYCLES"
s.cycles.samples = 32
s.render.resolution_x = s.render.resolution_y = 1024
s.render.resolution_percentage = 100
s.render.film_transparent = True
s.render.image_settings.file_format = "PNG"
s.render.image_settings.color_mode = "RGBA"
s.world = bpy.data.worlds.new("Neutral studio")
s.world.use_nodes = True
s.world.node_tree.nodes["Background"].inputs[0].default_value = (0.65, 0.72, 0.82, 1)
s.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
s.view_settings.view_transform = "Standard"
mat = bpy.data.materials.new("Warm hewn timber")
mat.diffuse_color = (0.34, 0.18, 0.075, 1)
mat.use_nodes = True
p = mat.node_tree.nodes.get("Principled BSDF")
p.inputs["Base Color"].default_value = mat.diffuse_color
p.inputs["Roughness"].default_value = 0.9
nodes = mat.node_tree.nodes
links = mat.node_tree.links
coords = nodes.new("ShaderNodeTexCoord")
stretch = nodes.new("ShaderNodeVectorMath")
stretch.operation = "MULTIPLY"
stretch.inputs[1].default_value = (3, 3, 0.12)
links.new(coords.outputs["Generated"], stretch.inputs[0])
noise = nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 4
noise.inputs["Detail"].default_value = 2
noise.inputs["Roughness"].default_value = 0.6
links.new(stretch.outputs[0], noise.inputs["Vector"])
ramp = nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.2
ramp.color_ramp.elements[0].color = (0.10, 0.065, 0.035, 1)
ramp.color_ramp.elements[1].position = 0.8
ramp.color_ramp.elements[1].color = (0.40, 0.28, 0.16, 1)
links.new(noise.outputs["Fac"], ramp.inputs[0])
links.new(ramp.outputs[0], p.inputs["Base Color"])
bump = nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.13
bump.inputs["Distance"].default_value = 0.025
links.new(noise.outputs["Fac"], bump.inputs["Height"])
links.new(bump.outputs[0], p.inputs["Normal"])
bpy.ops.object.camera_add()
cam = bpy.context.object
s.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = 1254 / 145
az, el = map(math.radians, (22.5, 28.5))
direction = Vector(
    (math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el))
)
cam.location = direction * 30
cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
# Camera shift locates the front-left foot at source pixel (302,1060).
cam.data.shift_x = (627 - 302) / 1254
cam.data.shift_y = (1060 - 627) / 1254
bpy.ops.object.light_add(type="AREA", location=(-4, -6, 10))
bpy.context.object.rotation_euler = (
    (Vector((1.6, 2, 2)) - bpy.context.object.location)
    .to_track_quat("-Z", "Y")
    .to_euler()
)
bpy.context.object.data.energy = 1200
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 4
parts = []


def beam(name, a, b, width=0.18, start=0, end=50):
    a, b = Vector(a), Vector(b)
    d = b - a
    if name in {
        "Scaffold upright",
        "Scaffold rail",
        "Scaffold diagonal",
        "Ladder rail",
    }:
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=7, radius=0.5, depth=1, location=(a + b) / 2
        )
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(a + b) / 2)
    o = bpy.context.object
    o.name = name
    o.dimensions = (width, width, d.length)
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for vertex in o.data.vertices:
        vertex.co.x += random.uniform(-0.012, 0.012)
        vertex.co.y += random.uniform(-0.012, 0.012)
    o.data.materials.append(mat)
    mod = o.modifiers.new("Soft hewn edges", "BEVEL")
    mod.width = 0.025
    mod.segments = 2
    o.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    parts.append(
        {
            "name": o.name,
            "a": list(a),
            "b": list(b),
            "width": width,
            "start": start,
            "end": end,
        }
    )


w, d, h = 3.2, 4.2, 2.9
for y in [0, d]:
    beam("Sill cross", (0, y, 0.1), (w, y, 0.1), 0.22, 0, 10)
for x in [0, w]:
    beam("Sill side", (x, 0, 0.1), (x, d, 0.1), 0.22, 1, 12)
for j, y in enumerate([d, d / 2, 0]):
    for x in [0, w]:
        beam("Upright", (x, y, 0.1), (x, y, h), 0.22, 8 + j * 3, 26 + j * 3)
    beam("Tie beam", (0, y, h), (w, y, h), 0.2, 28 + j * 2, 34 + j * 2)
    beam(
        "Rafter left",
        (-0.25, y, h - 0.12),
        (w / 2, y, 5.1),
        0.19,
        34 + j * 3,
        47 + j * 3,
    )
    beam(
        "Rafter right",
        (w + 0.25, y, h - 0.12),
        (w / 2, y, 5.1),
        0.19,
        35 + j * 3,
        48 + j * 3,
    )
for x in [0, w]:
    beam("Wall plate", (x, 0, h), (x, d, h), 0.22, 27, 35)
    for y in [0, d / 2]:
        beam("Side brace", (x, y, 0.9), (x, y + 0.9, 1.8), 0.15, 23, 35)
beam("Ridge", (w / 2, 0, 5.1), (w / 2, d, 5.1), 0.21, 44, 56)
for x in [1, 2.2]:
    beam("Door jamb", (x, 0, 0.1), (x, 0, 1.8), 0.17, 15, 30)
beam("Door header", (1, 0, 1.8), (2.2, 0, 1.8), 0.17, 28, 36)
beam("Front loft rail", (0, 0, 1.85), (w, 0, 1.85), 0.19, 30, 40)
beam("Gable post", (w / 2, 0, h), (w / 2, 0, 5.1), 0.18, 35, 49)
add_site(beam, parts, mat)
from bpy_extras.object_utils import world_to_camera_view

for part in parts:
    for key in ["a", "b"]:
        p = world_to_camera_view(s, cam, Vector(part[key]))
        part[key + "Pixel"] = [p.x * 1024, (1 - p.y) * 1024]
(R / "parts.json").write_text(json.dumps(parts, indent=2) + "\n")
bpy.ops.wm.save_as_mainfile(filepath=str(R / "frame.blend"))
for part in parts:
    bpy.data.objects[part["name"]].hide_render = part["end"] != 0
s.render.filepath = str(R / "site-base.png")
bpy.ops.render.render(write_still=True)
for part in parts:
    bpy.data.objects[part["name"]].hide_render = part["end"] == 0
s.render.filepath = str(R / "frame-render.png")
bpy.ops.render.render(write_still=True)
for part in parts:
    o = bpy.data.objects[part["name"]]
    m = bpy.data.materials.new(part["name"] + " timing")
    m.use_nodes = True
    n = m.node_tree.nodes
    l = m.node_tree.links
    n.clear()
    coord = n.new("ShaderNodeTexCoord")
    xyz = n.new("ShaderNodeSeparateXYZ")
    l.new(coord.outputs["Generated"], xyz.inputs[0])
    scale = n.new("ShaderNodeMath")
    scale.operation = "MULTIPLY_ADD"
    scale.inputs[1].default_value = (part["end"] - part["start"]) / 60
    scale.inputs[2].default_value = part["start"] / 60
    l.new(xyz.outputs["Z"], scale.inputs[0])
    emission = n.new("ShaderNodeEmission")
    l.new(scale.outputs[0], emission.inputs[0])
    output = n.new("ShaderNodeOutputMaterial")
    l.new(emission.outputs[0], output.inputs[0])
    o.data.materials.clear()
    o.data.materials.append(m)
s.view_settings.view_transform = "Raw"
s.render.filepath = str(R / "frame-time-render.png")
bpy.ops.render.render(write_still=True)
