"""Independent temporary equipment; positions share the farm's modelling coordinates."""

import math
import random

import bpy
from mathutils import Vector


def add_site(beam, parts, timber):
    rng = random.Random(71)

    def material(name, color):
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*color, 1)
        m.use_nodes = True
        p = m.node_tree.nodes.get("Principled BSDF")
        p.inputs["Base Color"].default_value = m.diffuse_color
        p.inputs["Roughness"].default_value = 1
        return m

    soil = material("Trampled earth", (0.19, 0.135, 0.075))
    nodes, links = soil.node_tree.nodes, soil.node_tree.links
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 7
    noise.inputs["Detail"].default_value = 2
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.10, 0.075, 0.042, 1)
    ramp.color_ramp.elements[1].color = (0.29, 0.22, 0.13, 1)
    links.new(noise.outputs["Fac"], ramp.inputs[0])
    links.new(ramp.outputs[0], nodes.get("Principled BSDF").inputs["Base Color"])
    clay = material("Unfired clay", (0.40, 0.29, 0.17))
    rope = material("Flax lashings", (0.45, 0.37, 0.23))

    def register(o, start=0, end=0, width=0):
        parts.append(
            {
                "name": o.name,
                "a": list(o.location),
                "b": list(o.location + Vector((0, 0, 0.1))),
                "width": width,
                "start": start,
                "end": end,
            }
        )

    # Small irregular patches leave open grass around the door instead of a rectangular base.
    for cx, cy, rx, ry in [
        (1.5, 1.9, 1.9, 2.2),
        (3.5, 1.8, 0.60, 1.75),
        (-0.25, 0.7, 0.70, 1.2),
    ]:
        verts = []
        for i in range(40):
            a = i * math.tau / 40
            r = rng.uniform(0.88, 1.05)
            verts.append((cx + math.cos(a) * rx * r, cy + math.sin(a) * ry * r, 0.012))
        mesh = bpy.data.meshes.new("Worn ground")
        mesh.from_pydata(verts, [], [list(range(40))])
        o = bpy.data.objects.new("Worn ground", mesh)
        bpy.context.collection.objects.link(o)
        o.data.materials.append(soil)
        register(o)

    # An asymmetric side scaffold leaves the front entrance and workers' approach clear.
    for j, y in enumerate([0.35, 2.05, 3.8]):
        beam(
            "Scaffold upright",
            (3.83, y, 0.06),
            (3.80 + rng.uniform(-0.05, 0.05), y + 0.04, 2.65),
            0.13,
            4 + j,
            20 + j,
        )
        beam("Platform bearer", (3.10, y, 1.60), (4.03, y, 1.60), 0.12, 18, 23)
    for x in [3.40, 3.64, 3.88]:
        beam(
            "Work platform plank",
            (x, 0.18, 1.65),
            (x, 3.95 + rng.uniform(-0.09, 0.09), 1.65),
            0.21,
            23,
            28,
        )
        o = bpy.context.object
        for v in o.data.vertices:
            v.co.y *= 0.26
    beam("Scaffold rail", (3.83, 0.3, 2.5), (3.83, 3.9, 2.5), 0.10, 28, 31)
    for y in [0.35, 2.05]:
        beam("Scaffold diagonal", (3.85, y, 0.25), (3.85, y + 1.6, 1.58), 0.10, 15, 24)
    for x in [3.48, 3.94]:
        beam("Ladder rail", (x, -0.08, 0.05), (x, 0.85, 1.95), 0.085, 26, 31)
    for i in range(8):
        t = (i + 1) / 9
        beam(
            "Ladder rung",
            (3.46, -0.08 + 0.93 * t, 0.05 + 1.9 * t),
            (3.96, -0.08 + 0.93 * t, 0.05 + 1.9 * t),
            0.065,
            28,
            32,
        )

    for y in [0.35, 2.05, 3.8]:
        for z in [1.60, 2.48]:
            for k in range(3):
                bpy.ops.mesh.primitive_torus_add(
                    major_segments=12,
                    minor_segments=4,
                    location=(3.83, y, z + (k - 1) * 0.025),
                    major_radius=0.105,
                    minor_radius=0.018,
                )
                o = bpy.context.object
                o.name = "Scaffold rope lashing"
                o.data.materials.append(rope)
                register(o, 24, 25)

    # Loose supplies communicate wood and clay; quantities are decorative, not inventory counters.
    for row in range(3):
        for j in range(3 - row):
            x = -0.57 + j * 0.19 + row * 0.08
            beam(
                "Stacked timber",
                (x, 0.28, 0.14 + row * 0.18),
                (x, 1.85 + rng.uniform(-0.16, 0.16), 0.14 + row * 0.18),
                0.16,
                0,
                0,
            )
    for j in range(3):
        beam(
            "Loose offcut",
            (-0.72 + j * 0.23, -0.3, 0.08),
            (-0.32 + j * 0.24, 0.15, 0.08),
            0.10,
            0,
            0,
        )
    for i in range(9):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=2,
            radius=1,
            location=(
                -0.35 + rng.uniform(-0.27, 0.25),
                -0.32 + rng.uniform(-0.20, 0.16),
                0.10,
            ),
        )
        o = bpy.context.object
        o.name = "Clay clod"
        o.scale = (
            rng.uniform(0.12, 0.23),
            rng.uniform(0.11, 0.19),
            rng.uniform(0.06, 0.14),
        )
        o.data.materials.append(clay)
        register(o)
