import math

import bpy
from mathutils import Vector


def attach_head_socket(config, armature, rotation):
    anchor = rotation @ Vector(config['head_pivot'])
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    source = armature.data.edit_bones['Head']
    socket = armature.data.edit_bones.new('HeadSocket')
    socket.matrix = source.matrix.copy()
    socket.head = armature.matrix_world.inverted() @ anchor
    socket.tail = socket.head + source.vector.normalized() * 0.1
    socket.parent = armature.data.edit_bones['neck']
    bpy.ops.object.mode_set(mode='OBJECT')
    constraint = armature.pose.bones['HeadSocket'].constraints.new('COPY_ROTATION')
    constraint.target = armature
    constraint.subtarget = 'Head'
    constraint.target_space = 'WORLD'
    constraint.owner_space = 'WORLD'
    bpy.context.view_layer.update()


def neck_weights(z, bottom, height, head_bone, torso_bone=None):
    phase = max(0, min(1, (z-bottom)/height))
    if not torso_bone:
        return {'neck': 1-phase, head_bone: phase}
    if phase < 0.5:
        t = phase*2
        t = t*t*(3-2*t)
        return {torso_bone: 1-t, 'neck': t}
    t = (phase-0.5)*2
    t = t*t*(3-2*t)
    return {'neck': 1-t, head_bone: t}


def bridge_neck(config, armature, rotation):
    bridge = config['neck_bridge']
    segments = 24
    rings = 9
    vertices = []
    for ring in range(rings):
        z = bridge['bottom']+(bridge['top']-bridge['bottom'])*ring/(rings-1)
        for i in range(segments):
            angle = i * math.tau / segments
            vertices.append(rotation @ Vector((math.cos(angle)*bridge['radius_x'],
                bridge['center_y']+math.sin(angle)*bridge['radius_y'], z)))
    faces = []
    for ring in range(rings-1):
        base = ring*segments
        faces.extend((base+i, base+(i+1)%segments, base+(i+1)%segments+segments,
                      base+i+segments) for i in range(segments))
    faces.extend([tuple(reversed(range(segments))), tuple(range((rings-1)*segments,rings*segments))])
    mesh = bpy.data.meshes.new('NeckOverlap')
    mesh.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new('NeckOverlap', mesh)
    bpy.context.collection.objects.link(obj)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    head_bone = 'HeadSocket' if config.get('head_pivot') else 'Head'
    for ring in range(rings):
        z = bridge['bottom']+(bridge['top']-bridge['bottom'])*ring/(rings-1)
        weights = neck_weights(z, bridge['bottom'], bridge['top']-bridge['bottom'],
                               head_bone, config.get('neck_torso_bone'))
        for bone, weight in weights.items():
            group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            group.add(list(range(ring*segments,(ring+1)*segments)),weight,'REPLACE')
    modifier = obj.modifiers.new('Shared animation','ARMATURE')
    modifier.object = armature
    material = bpy.data.materials.new('NeckSkin')
    material.use_nodes = True
    material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = bridge['color']
    mesh.materials.append(material)


def blend_neck_weights(head, rotation, center, config, head_bone):
    bottom = config.get('neck_blend_start', center.z)
    height = config['neck_blend_height']
    radius = config.get('neck_blend_radius')
    back_radius = config.get('neck_blend_back_radius')
    torso_bone = config.get('neck_torso_bone')
    inset = config.get('neck_inset', 0)
    base_scale = config.get('neck_base_scale', 1)
    for vertex in head.data.vertices:
        p = rotation.inverted() @ vertex.co
        region = back_radius if back_radius and p.y > center.y else radius
        if region and ((p.x-center.x)/region[0])**2 + ((p.y-center.y)/region[1])**2 > 1:
            continue
        phase = max(0, min(1, (p.z-bottom)/height))
        if phase >= 1:
            continue
        taper = 1-(1-base_scale)*(1-phase)**2
        p.x = center.x+(p.x-center.x)*taper
        p.y = center.y+(p.y-center.y)*taper
        p.z -= inset*(1-phase)**2
        vertex.co = rotation @ p
        weights = neck_weights(p.z, bottom-inset, height+inset, head_bone, torso_bone)
        for bone, weight in weights.items():
            group = head.vertex_groups.get(bone) or head.vertex_groups.new(name=bone)
            group.add([vertex.index], weight, 'REPLACE')
        if head_bone not in weights:
            head.vertex_groups[head_bone].add([vertex.index],0,'REPLACE')
