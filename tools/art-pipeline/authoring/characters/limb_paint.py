from pathlib import Path

import bpy


def restore_limb_paint(meshes, texture_file, occlusion=0.0):
    texture = bpy.data.images.load(str(Path(texture_file).resolve()), check_existing=True)
    materials = set()
    for obj in meshes:
        mask = obj.data.color_attributes.new(name='limb_source_mix', type='FLOAT_COLOR', domain='POINT')
        groups = {group.index: group.name for group in obj.vertex_groups}
        limbs = {'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'}
        for vertex in obj.data.vertices:
            value = 0.0
            for group in vertex.groups:
                name = groups[group.group]
                if name not in limbs:
                    continue
                value += group.weight
            value = max(0.0, min(1.0, (value - 0.1) / 0.7))
            value = value * value * (3 - 2 * value)
            mask.data[vertex.index].color = (value, value, value, 1)
        materials.update(slot.material for slot in obj.material_slots if slot.material)
    for material in materials:
        nodes, links = material.node_tree.nodes, material.node_tree.links
        output = next(node for node in nodes if node.type == 'OUTPUT_MATERIAL')
        emission = output.inputs['Surface'].links[0].from_node
        if emission.type != 'EMISSION':
            raise ValueError('Limb paint correction requires the unlit character material')
        original = emission.inputs['Color'].links[0].from_socket
        image = nodes.new('ShaderNodeTexImage')
        image.image = texture
        mask = nodes.new('ShaderNodeAttribute')
        mask.attribute_name = 'limb_source_mix'
        mix = nodes.new('ShaderNodeMixRGB')
        links.new(mask.outputs['Fac'], mix.inputs[0])
        links.new(original, mix.inputs[1])
        color = image.outputs['Color']
        if occlusion > 0:
            contact = nodes.new('ShaderNodeAmbientOcclusion')
            contact.inputs['Distance'].default_value = 0.12
            shade = nodes.new('ShaderNodeMixRGB')
            shade.blend_type = 'MULTIPLY'
            shade.inputs[0].default_value = occlusion
            links.new(color, shade.inputs[1])
            links.new(contact.outputs['AO'], shade.inputs[2])
            color = shade.outputs[0]
        links.new(color, mix.inputs[2])
        links.new(mix.outputs[0], emission.inputs['Color'])
