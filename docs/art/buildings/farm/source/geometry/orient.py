"""Compare fixed orthographic cameras and materials on the multi-view reconstruction."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

root = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root / 'model.glb'))
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
report = {'sourceBounds': [list(lo), list(hi)], 'objects': [
    {'name': o.name, 'vertices': len(o.data.vertices), 'faces': len(o.data.polygons)} for o in meshes]}
parent = bpy.data.objects.new('Farm scale', None)
bpy.context.collection.objects.link(parent)
for obj in [o for o in scene.objects if o != parent and o.parent is None]:
    obj.parent = parent
factor = 6.8 / (hi.z - lo.z)
parent.scale = (factor,) * 3
parent.location = Vector((-(lo.x+hi.x)/2, -(lo.y+hi.y)/2, -lo.z)) * factor
bpy.context.view_layer.update()

scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.8,.83,.88,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .6
bpy.ops.object.light_add(type='AREA', location=(-4,-6,11))
light = bpy.context.object
light.data.energy = 1700
light.data.shape = 'DISK'
light.data.size = 5
light.rotation_euler = (Vector((0,0,3))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 9.8
scene.camera = camera
target = Vector((0,0,3.2))
def set_camera(elevation, azimuth):
    el,az = map(math.radians,(elevation,azimuth))
    camera.location = target + Vector((math.cos(el)*math.sin(az),-math.cos(el)*math.cos(az),math.sin(el)))*30
    camera.rotation_euler = (target-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()
def render(name):
    scene.render.filepath = str(root/(name+'.png'))
    bpy.ops.render.render(write_still=True)
def textured(unlit):
    for material in bpy.data.materials:
        if not material.node_tree:
            continue
        nodes=material.node_tree.nodes
        shader=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
        output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
        if not shader or not output:
            continue
        if unlit:
            emission=nodes.new('ShaderNodeEmission')
            color=shader.inputs['Base Color']
            if color.is_linked:
                material.node_tree.links.new(color.links[0].from_socket,emission.inputs['Color'])
            else:
                emission.inputs['Color'].default_value=color.default_value
            material.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
        else:
            shader.inputs['Roughness'].default_value=1
            shader.inputs['Metallic'].default_value=0
            material.node_tree.links.new(shader.outputs[0],output.inputs['Surface'])

set_camera(28.5,22.5)
textured(True)
scene.render.resolution_x = scene.render.resolution_y = 512
report.update({'heightMetresProvisional':6.8,'orthographicSpan':9.8,'elevation':28.5,'azimuth':22.5,'sourceResolution':1024})
(root/'mesh-inspection.json').write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(root/'farm.blend'))
for index in range(4):
    set_camera(28.5,22.5+index*90)
    render('orientation-'+str(index))
