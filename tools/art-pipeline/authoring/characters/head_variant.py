import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


def replace_head(model_file, config_file, bands, yaw_degrees):
    from blender_common import toonify_materials, unlit_materials

    config = json.loads(Path(config_file).read_text())
    if config['construction'] != 'bald-neck-socket':
        raise ValueError('Head replacement requires a prepared bald neck socket')
    armature = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    bodies = [o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.vertices) > 100]
    rotation = Matrix.Rotation(math.radians(yaw_degrees), 4, 'Z')
    head_bone = 'HeadSocket' if config.get('head_pivot') else 'Head'
    if config.get('head_pivot'):
        from neck_socket import attach_head_socket
        attach_head_socket(config, armature, rotation)
    for body in bodies:
        rest_world = rotation.inverted() @ body.matrix_world
        bm = bmesh.new()
        bm.from_mesh(body.data)
        removed = []
        for vertex in bm.verts:
            p = rest_world @ vertex.co
            chin = p.z > config['chin_min_z'] and p.y < config['chin_front_y'] and abs(p.x) < config['chin_half_width']
            if p.z > config['cut_z'] or chin:
                removed.append(vertex)
        bmesh.ops.delete(bm, geom=removed, context='VERTS')
        bm.to_mesh(body.data)
        bm.free()
        print('SOCKET removed vertices',len(removed))
    before = set(bpy.context.scene.objects)
    old_materials = set(bpy.data.materials)
    bpy.ops.import_scene.gltf(filepath=str(Path(model_file).resolve()))
    imported = set(bpy.context.scene.objects) - before
    heads = [o for o in imported if o.type == 'MESH']
    points = [o.matrix_world @ v.co for o in heads for v in o.data.vertices]
    low, high = min(p.z for p in points), max(p.z for p in points)
    neck = [p for p in points if p.z < low + (high-low)*0.06]
    center = Vector(((min(p.x for p in neck)+max(p.x for p in neck))/2,
                     (min(p.y for p in neck)+max(p.y for p in neck))/2, low))
    if 'source_neck_origin' in config:
        center = Vector(config['source_neck_origin'])
    scale = config['height'] / (high-low)
    destination = Vector(config['neck_origin'])
    for head in heads:
        world = head.matrix_world.copy()
        head.parent = None
        head.matrix_world = Matrix.Identity(4)
        for vertex in head.data.vertices:
            vertex.co = rotation @ ((world @ vertex.co-center)*scale+destination)
        head.vertex_groups.clear()
        group = head.vertex_groups.new(name=head_bone)
        group.add(list(range(len(head.data.vertices))), 1, 'REPLACE')
        if config.get('neck_blend_height'):
            from neck_socket import blend_neck_weights
            blend_neck_weights(head, rotation, destination, config, head_bone)
        modifier = head.modifiers.new('Shared animation', 'ARMATURE')
        modifier.object = armature
        head.name = 'HeadVariant'
    if config.get('neck_bridge'):
        from neck_socket import bridge_neck
        bridge_neck(config, armature, rotation)
    for obj in imported:
        if obj.type != 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
    paint_file = Path(model_file).with_name('painted-base.png')
    if paint_file.exists():
        paint = bpy.data.images.load(str(paint_file.resolve()), check_existing=True)
        for material in set(bpy.data.materials)-old_materials:
            if not material.use_nodes:
                continue
            for node in material.node_tree.nodes:
                if node.type == 'BSDF_PRINCIPLED' and node.inputs['Base Color'].is_linked:
                    image_node = node.inputs['Base Color'].links[0].from_node
                    if image_node.type != 'TEX_IMAGE':
                        raise ValueError('Head material needs a direct base-colour texture')
                    image_node.image = paint
    if config.get('unlit', True):
        unlit_materials()
    elif bands:
        toonify_materials(bands, materials=set(bpy.data.materials)-old_materials)
    bpy.context.view_layer.update()
