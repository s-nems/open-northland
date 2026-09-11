import math
import os
import bpy

TOON_SHADOW = 0.45
FREESTYLE_CREASE_DEG = 110.0
FREESTYLE_LINE_COLOR = (0.08, 0.05, 0.03)
FREESTYLE_THICKNESS_PX = 2.0

def apply_style(args):
    """Apply the optional look flags after import: texture swap, unlit colour, banded shading and crease lines."""
    if args.texture:
        swap_base_colour(args.texture)
    if args.unlit:
        unlit_materials()
    if args.toon > 0:
        toonify_materials(args.toon)
    if args.freestyle:
        enable_freestyle()


def base_colour_nodes():
    """(material, image node) pairs for every image feeding a Principled Base Color."""
    pairs = []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        principled = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if principled is None or not principled.inputs["Base Color"].is_linked:
            continue
        node = principled.inputs["Base Color"].links[0].from_node
        if node.type == "TEX_IMAGE":
            pairs.append((mat, node))
    return pairs


def swap_base_colour(path):
    image = bpy.data.images.load(os.path.abspath(path))
    for mat, node in base_colour_nodes():
        node.image = image
        print("TEXTURE", mat.name, "->", os.path.basename(path))


def unlit_materials():
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        principled = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        output = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if principled is None or output is None:
            continue
        emission = nt.nodes.new("ShaderNodeEmission")
        base = principled.inputs["Base Color"]
        if base.is_linked:
            nt.links.new(base.links[0].from_socket, emission.inputs["Color"])
        else:
            emission.inputs["Color"].default_value = tuple(base.default_value)
        nt.links.new(emission.outputs["Emission"], output.inputs["Surface"])


def toonify_materials(bands, materials=None):
    """Replace every material's shading with white diffuse lighting quantised to `bands` steps times the base colour."""
    for mat in bpy.data.materials if materials is None else materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        principled = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        output = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if principled is None or output is None:
            continue
        base = principled.inputs["Base Color"]
        diffuse = nt.nodes.new("ShaderNodeBsdfDiffuse")
        diffuse.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        to_rgb = nt.nodes.new("ShaderNodeShaderToRGB")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "CONSTANT"
        stops = ramp.color_ramp.elements
        while len(stops) > 1:
            stops.remove(stops[-1])
        for i in range(bands):
            stop = stops[0] if i == 0 else stops.new(i / bands)
            stop.position = i / bands
            value = TOON_SHADOW + (1.0 - TOON_SHADOW) * (i / max(1, bands - 1))
            stop.color = (value, value, value, 1.0)
        multiply = nt.nodes.new("ShaderNodeVectorMath")
        multiply.operation = "MULTIPLY"
        emission = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
        nt.links.new(to_rgb.outputs["Color"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], multiply.inputs[0])
        if base.is_linked:
            nt.links.new(base.links[0].from_socket, multiply.inputs[1])
        else:
            multiply.inputs[1].default_value = tuple(base.default_value)[:3]
        nt.links.new(multiply.outputs["Vector"], emission.inputs["Color"])
        nt.links.new(emission.outputs["Emission"], output.inputs["Surface"])


def enable_freestyle():
    scene = bpy.context.scene
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    scene.render.line_thickness = FREESTYLE_THICKNESS_PX
    view_layer = bpy.context.view_layer
    view_layer.use_freestyle = True
    settings = view_layer.freestyle_settings
    settings.crease_angle = math.radians(FREESTYLE_CREASE_DEG)
    settings.use_culling = True
    for lineset in list(settings.linesets):
        settings.linesets.remove(lineset)
    lineset = settings.linesets.new("Creases")
    lineset.select_silhouette = False
    lineset.select_border = False
    lineset.select_crease = True
    lineset.select_edge_mark = False
    lineset.select_contour = False
    lineset.select_external_contour = False
    lineset.select_material_boundary = False
    lineset.linestyle.color = FREESTYLE_LINE_COLOR
    lineset.linestyle.thickness = FREESTYLE_THICKNESS_PX
