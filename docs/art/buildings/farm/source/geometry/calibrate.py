"""Correct inferred model orientation/proportions, then compare camera elevation."""
import bpy
import math
from pathlib import Path
from mathutils import Vector

root=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(root/'farm.blend'))
scene=bpy.context.scene
parent=bpy.data.objects['Farm scale']
# Front/back renders identify the generated entrance normal as -X.
parent.rotation_euler.z=math.pi/2
# Cardinal input silhouettes imply narrower width and depth than the inferred mesh.
parent.scale.x*=.745
parent.scale.y*=.875
scene.render.resolution_x=scene.render.resolution_y=1024
scene.cycles.samples=8
scene.render.use_persistent_data=True
scene.cycles.device='CPU'
camera=scene.camera
target=Vector((0,0,3.2))
def point_camera(el,az):
    el,az=map(math.radians,(el,az))
    camera.location=target+Vector((math.cos(el)*math.sin(az),-math.cos(el)*math.cos(az),math.sin(el)))*30
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
def render(name):
    scene.render.filepath=str(root/(name+'.png'))
    bpy.ops.render.render(write_still=True)
point_camera(28.5,22.5)
render('calibrated-unlit')
for material in bpy.data.materials:
    if not material.node_tree:
        continue
    nodes=material.node_tree.nodes
    shader=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
    output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
    if shader and output:
        shader.inputs['Roughness'].default_value=1
        shader.inputs['Metallic'].default_value=0
        material.node_tree.links.new(shader.outputs[0],output.inputs['Surface'])
render('calibrated-lit')
point_camera(30,22.5)
render('camera-30')
point_camera(30,45)
render('camera-45')
point_camera(28.5,22.5)
bpy.ops.wm.save_as_mainfile(filepath=str(root/'calibrated.blend'))
