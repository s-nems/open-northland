"""Inspect ridge geometry and produce an orthographic elevation for door calibration."""
import bpy, json, numpy as np
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'raw.glb'))
o=next(o for o in bpy.context.scene.objects if o.type=='MESH')
a=np.empty(len(o.data.vertices)*3,dtype=np.float32)
o.data.vertices.foreach_get('co',a);a=a.reshape(-1,3)
report={'vertex_bounds':[a.min(axis=0).tolist(),a.max(axis=0).tolist()], 'material_nodes':[{ 'name':m.name,'nodes':[(n.name,n.type) for n in m.node_tree.nodes]} for m in o.data.materials if m and m.node_tree]}
(root/'measurements-raw.json').write_text(json.dumps(report,indent=2))
for m in o.data.materials:
    nt=m.node_tree
    tex=next(n for n in nt.nodes if n.type=='TEX_IMAGE')
    out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
    emission=nt.nodes.new('ShaderNodeEmission');nt.links.new(tex.outputs['Color'],emission.inputs['Color']);nt.links.new(emission.outputs[0],out.inputs['Surface'])
s=bpy.context.scene;bpy.ops.object.camera_add(location=(0,-8,0));cam=bpy.context.object
cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.2;s.camera=cam
s.render.engine='CYCLES';s.cycles.samples=8;s.render.resolution_x=1100;s.render.resolution_y=1100;s.render.resolution_percentage=100;s.render.film_transparent=True;s.render.image_settings.color_mode='RGBA';s.view_settings.view_transform='Standard';s.render.filepath=str(root/'front-elevation.png')
bpy.ops.render.render(write_still=True)
