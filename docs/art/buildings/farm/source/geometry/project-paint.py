"""Project camera painting onto visible surfaces; render alpha from geometry."""
import bpy
from pathlib import Path

root=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(root/'calibrated.blend'))
scene=bpy.context.scene
scene.cycles.samples=8
camera=scene.camera
materials=[m for m in bpy.data.materials if m.node_tree]
graphs=[]
for material in materials:
    nodes=material.node_tree.nodes
    links=material.node_tree.links
    shader=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
    output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
    if not shader or not output:
        continue
    coords=nodes.new('ShaderNodeTexCoord')
    coords.object=camera
    scale=nodes.new('ShaderNodeVectorMath')
    scale.operation='SCALE'
    scale.inputs[3].default_value=1/camera.data.ortho_scale
    links.new(coords.outputs['Object'],scale.inputs[0])
    offset=nodes.new('ShaderNodeVectorMath')
    offset.operation='ADD'
    offset.inputs[1].default_value=(.5,.5,0)
    links.new(scale.outputs[0],offset.inputs[0])
    split=nodes.new('ShaderNodeSeparateXYZ')
    links.new(coords.outputs['Object'],split.inputs[0])
    depth=nodes.new('ShaderNodeMath')
    depth.operation='MULTIPLY_ADD'
    depth.inputs[1].default_value=1/40
    depth.inputs[2].default_value=1
    links.new(split.outputs['Z'],depth.inputs[0])
    emission=nodes.new('ShaderNodeEmission')
    links.new(depth.outputs[0],emission.inputs['Color'])
    links.new(emission.outputs[0],output.inputs['Surface'])
    graphs.append((material,shader,output,offset,depth,emission))

# A geometry depth render supplies the occlusion test; no silhouette mask is authored.
scene.render.image_settings.file_format='OPEN_EXR'
scene.render.image_settings.color_depth='32'
scene.render.filepath=str(root/'projection-depth.exr')
bpy.ops.render.render(write_still=True)
depth_image=bpy.data.images.load(str(root/'projection-depth.exr'),check_existing=False)
depth_image.colorspace_settings.name='Non-Color'
paint=bpy.data.images.load(str(root/'paint.png'),check_existing=False)
for material,shader,output,uv,depth,emission in graphs:
    nodes=material.node_tree.nodes
    links=material.node_tree.links
    source=shader.inputs['Base Color']
    depth_tex=nodes.new('ShaderNodeTexImage')
    depth_tex.image=depth_image
    depth_tex.interpolation='Closest'
    depth_tex.extension='CLIP'
    links.new(uv.outputs[0],depth_tex.inputs['Vector'])
    sample=nodes.new('ShaderNodeSeparateColor')
    links.new(depth_tex.outputs['Color'],sample.inputs[0])
    difference=nodes.new('ShaderNodeMath')
    difference.operation='SUBTRACT'
    links.new(depth.outputs[0],difference.inputs[0])
    links.new(sample.outputs[0],difference.inputs[1])
    absolute=nodes.new('ShaderNodeMath')
    absolute.operation='ABSOLUTE'
    links.new(difference.outputs[0],absolute.inputs[0])
    visible=nodes.new('ShaderNodeMath')
    visible.operation='LESS_THAN'
    visible.inputs[1].default_value=.035/40
    links.new(absolute.outputs[0],visible.inputs[0])
    gate=nodes.new('ShaderNodeMath')
    gate.operation='MULTIPLY'
    links.new(visible.outputs[0],gate.inputs[0])
    links.new(depth_tex.outputs['Alpha'],gate.inputs[1])
    painting=nodes.new('ShaderNodeTexImage')
    painting.image=paint
    painting.extension='CLIP'
    # Register the painted frame using roof and threshold landmarks.
    registered=nodes.new('ShaderNodeVectorMath')
    registered.operation='MULTIPLY_ADD'
    registered.inputs[1].default_value=(1.02,.976,1)
    registered.inputs[2].default_value=(-.01,.038,0)
    links.new(uv.outputs[0],registered.inputs[0])
    links.new(registered.outputs[0],painting.inputs['Vector'])
    # Keep original material near geometry contours where projection drifts.
    factor=gate.outputs[0]
    for dx,dy in [(0.025,0),(-0.025,0),(0,0.025),(0,-0.025)]:
        neighbour=nodes.new('ShaderNodeVectorMath')
        neighbour.operation='ADD'
        neighbour.inputs[1].default_value=(dx,dy,0)
        links.new(uv.outputs[0],neighbour.inputs[0])
        silhouette=nodes.new('ShaderNodeTexImage')
        silhouette.image=depth_image
        silhouette.extension='CLIP'
        links.new(neighbour.outputs[0],silhouette.inputs['Vector'])
        inside=nodes.new('ShaderNodeMath')
        inside.operation='MULTIPLY'
        links.new(factor,inside.inputs[0])
        links.new(silhouette.outputs['Alpha'],inside.inputs[1])
        factor=inside.outputs[0]
    mix=nodes.new('ShaderNodeMixRGB')
    links.new(factor,mix.inputs[0])
    if source.is_linked:
        links.new(source.links[0].from_socket,mix.inputs[1])
    else:
        mix.inputs[1].default_value=source.default_value
    links.new(painting.outputs['Color'],mix.inputs[2])
    links.new(mix.outputs[0],emission.inputs['Color'])

# Freeze the paint camera independently of later review-camera movement.
projection_camera=camera.copy()
projection_camera.data=camera.data.copy()
projection_camera.name='Fixed painting projection'
scene.collection.objects.link(projection_camera)
for material,shader,output,uv,depth,emission in graphs:
    for node in material.node_tree.nodes:
        if node.type=='TEX_COORD' and node.object==camera:
            node.object=projection_camera
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_depth='8'
scene.render.filepath=str(root/'final.png')
bpy.ops.render.render(write_still=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(root/'painted.blend'))
