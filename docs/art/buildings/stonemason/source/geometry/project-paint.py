"""Project the registered front painting onto visible geometry, retaining hidden materials."""
import bpy,json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'workshop.blend'));S=bpy.context.scene;cam=S.camera
meshes=[o for o in S.objects if o.type=='MESH']
for o in meshes:
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
 bpy.ops.object.convert(target='MESH')
bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();toward=cam.rotation_euler.to_matrix()@Vector((0,0,1))
im=bpy.data.images.load(str(R/'paint-white.png'));im.pack();pixels=list(im.pixels);w,h=im.size
# Landmark fit from the door, ridge and exterior corners; geometry never changes.
H=json.loads((R/'feature-registration.json').read_text())['homography']
def mapped(q):
 x,y=q.x*1536,(1-q.y)*1024;d=H[2][0]*x+H[2][1]*y+H[2][2]
 return ((H[0][0]*x+H[0][1]*y+H[0][2])/d/1536,1-(H[1][0]*x+H[1][1]*y+H[1][2])/d/1024)
materials={};count=0
for o in meshes:
 uv=o.data.uv_layers.get('FrontPaint') or o.data.uv_layers.new(name='FrontPaint')
 for loop in o.data.loops:
  q=world_to_camera_view(S,cam,o.matrix_world@o.data.vertices[loop.vertex_index].co)
  uv.data[loop.index].uv=mapped(q)
 origmats=list(o.data.materials)
 for f in o.data.polygons:
  center=o.matrix_world@f.center;normal=o.matrix_world.to_3x3()@f.normal
  isroof='thatch' in o.name.lower()
  if not isroof and abs(normal.dot(toward))<.02:continue
  hit,loc,_,_,_,_=S.ray_cast(deps,center+toward*30,-toward)
  if not isroof and (not hit or (loc-center).length>.025):continue
  q=world_to_camera_view(S,cam,center);u,v=mapped(q)
  ix=max(0,min(w-1,int(u*w)));iy=max(0,min(h-1,int(v*h)));px=pixels[(iy*w+ix)*4:(iy*w+ix)*4+3]
  if min(px)>.91:continue
  old=origmats[f.material_index];key=old.name
  if key not in materials:
   m=old.copy();m.name=key+' — painted front';nt=m.node_tree;n=nt.nodes;l=nt.links;out=next(n for n in n if n.type=='OUTPUT_MATERIAL');base=out.inputs['Surface'].links[0].from_socket
   tex=n.new('ShaderNodeTexImage');tex.image=im;tex.extension='EXTEND';uvn=n.new('ShaderNodeUVMap');uvn.uv_map='FrontPaint';l.new(uvn.outputs[0],tex.inputs[0]);em=n.new('ShaderNodeEmission');l.new(tex.outputs['Color'],em.inputs['Color'])
   sep=n.new('ShaderNodeSeparateColor');l.new(tex.outputs['Color'],sep.inputs[0]);mn=n.new('ShaderNodeMath');mn.operation='MINIMUM';l.new(sep.outputs[0],mn.inputs[0]);l.new(sep.outputs[1],mn.inputs[1]);mn2=n.new('ShaderNodeMath');mn2.operation='MINIMUM';l.new(mn.outputs[0],mn2.inputs[0]);l.new(sep.outputs[2],mn2.inputs[1]);threshold=n.new('ShaderNodeMath');threshold.operation='GREATER_THAN';threshold.inputs[1].default_value=.9;l.new(mn2.outputs[0],threshold.inputs[0]);mix=n.new('ShaderNodeMixShader');l.new(threshold.outputs[0],mix.inputs[0]);l.new(em.outputs[0],mix.inputs[1]);l.new(base,mix.inputs[2]);l.new(mix.outputs[0],out.inputs['Surface']);materials[key]=m
  m=materials[key]
  if m.name not in o.data.materials:o.data.materials.append(m)
  f.material_index=o.data.materials.find(m.name);count+=1
(R/'projection.json').write_text(json.dumps({'paintedPolygons':count,'registrationHomography':H,'visibilityTolerance':.025,'mode':'Front-view UV projection onto visible faces; hidden faces retain procedural materials; no raster masking or alpha editing.'},indent=2))
S.view_settings.view_transform='Standard';S.render.filepath=str(R/'final.png');bpy.ops.wm.save_as_mainfile(filepath=str(R/'workshop-painted.blend'));bpy.ops.render.render(write_still=True)
