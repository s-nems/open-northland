"""Editable stonemason construction, with deterministic material and joinery variation."""
import bpy, math, random, json
from mathutils import Vector
from pathlib import Path
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parent
rng=random.Random(84)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
S=bpy.context.scene
collections={}
for name in ['01_foundation','02_frame','03_walls','04_rafters','05_thatch','06_equipment']:
 c=bpy.data.collections.new(name);S.collection.children.link(c);collections[name]=c
stage='01_foundation'
def assign(o,name,mat):
 o.name=name;o.data.materials.append(mat)
 for c in list(o.users_collection):c.objects.unlink(o)
 collections[stage].objects.link(o)
 return o

def material(name,color,kind='wood'):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;bs=n.get('Principled BSDF');bs.inputs['Roughness'].default_value=.88
 tc=n.new('ShaderNodeTexCoord');mp=n.new('ShaderNodeVectorMath');mp.operation='MULTIPLY';mp.inputs[1].default_value=(9,9,.6) if kind=='wood' else (3,3,3);l.new(tc.outputs['Generated'],mp.inputs[0]);no=n.new('ShaderNodeTexNoise');no.inputs['Scale'].default_value=4;no.inputs['Detail'].default_value=2;l.new(mp.outputs[0],no.inputs[0]);ra=n.new('ShaderNodeValToRGB');ra.color_ramp.elements[0].position=.18;ra.color_ramp.elements[0].color=(*(v*.66 for v in color),1);ra.color_ramp.elements[1].position=.83;ra.color_ramp.elements[1].color=(*(min(1,v*1.2) for v in color),1);l.new(no.outputs['Fac'],ra.inputs[0]);l.new(ra.outputs[0],bs.inputs['Base Color']);b=n.new('ShaderNodeBump');b.inputs['Strength'].default_value=.19;b.inputs['Distance'].default_value=.035;l.new(no.outputs['Fac'],b.inputs['Height']);l.new(b.outputs[0],bs.inputs['Normal']);return m
wood=[material('Warm oak '+str(i),(.27+i*.025,.125+i*.014,.047+i*.007)) for i in range(5)]
stone=[material('Limestone '+str(i),(.32+i*.027,.325+i*.026,.30+i*.025),'stone') for i in range(5)]
straw=[material('Honey straw '+str(i),(.45+i*.024,.27+i*.016,.076+i*.006),'stone') for i in range(5)]
plaster=material('Warm clay plaster',(.58,.49,.35),'stone');metal=material('Forged iron',(.075,.09,.092),'stone');cloth=material('Unbleached linen',(.64,.58,.44),'stone');dark=material('Recessed interior',(.09,.055,.027))
def box(name,loc,size,mat,bevel=.035):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);assign(o,name,mat)
 if bevel:
  mod=o.modifiers.new('Soft hewn corners','BEVEL');mod.width=bevel;mod.segments=2
  o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
 return o

def beam(name,a,b,width=.19,depth=None,mat=None):
 a,b=Vector(a),Vector(b);o=box(name,(a+b)/2,(width,depth or width,(b-a).length),mat or rng.choice(wood),.026);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def rock(name,loc,size):
 o=box(name,loc,size,rng.choice(stone),.065)
 for v in o.data.vertices:
  v.co+=Vector((rng.uniform(-.035,.035),rng.uniform(-.028,.028),rng.uniform(-.025,.025)))
 o.rotation_euler.z=rng.uniform(-.06,.06);return o

def torus(name,loc,major,minor,mat,rot=(0,0,0)):
 bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=6,location=loc,major_radius=major,minor_radius=minor,rotation=rot);return assign(bpy.context.object,name,mat)

def cyl(name,loc,r,depth,mat,vertices=14):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc);o=assign(bpy.context.object,name,mat);mod=o.modifiers.new('Rounded rim','BEVEL');mod.width=.016;mod.segments=2;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o

# A real clear opening: x -2.29..-1.34, z .28..2.22.
doorx=-1.815;doorbottom=.28;doortop=2.22
# Low masonry sill and individual pad stones.
for x in [-3.25,.15,3.1]:
 for y in [-1.48,1.65]:
  for z in [.13,.36]:rock('Post footing',(x,y,z),(.48,.5,.24))
for row in range(2):
 for i in range(6):
  x=-3.05+i*.52
  if -2.32<x<-1.3:continue
  rock('Front rubble sill',(x,-1.39,.12+row*.22),(.49,.34,.22))
 for i in range(6):rock('Left rubble sill',(-3.2,-1.1+i*.49,.12+row*.22),(.35,.48,.22))
rock('Door threshold',(doorx,-1.63,.17),(1.18,.6,.28))
rock('Door step',(doorx,-1.96,.075),(1.32,.46,.15))
# Structural framing, complete under the future cladding.
stage='02_frame'
for x in [-3.25,.15,3.1]:
 for y in [-1.48,1.65]:beam('Hewn oak post',(x,y,.43),(x,y,2.64 if x<1 else 2.48),.24)
for y in [-1.48,1.65]:
 beam('House wall plate',(-3.37,y,2.67),(.28,y,2.67),.22)
 beam('Canopy wall plate',(.06,y,2.46),(3.23,y,2.46),.22)
 for x,sign in [(-3.25,1),(.15,-1),(.15,1),(3.1,-1)]:beam('Diagonal knee brace',(x,y,1.87),(x+sign*.59,y,2.56),.15)
for x in [-3.25,.15,3.1]:beam('Side wall plate',(x,-1.57,2.61),(x,1.76,2.61),.2)
for x in [doorx-.59,doorx+.59]:beam('Door jamb',(x,-1.52,.28),(x,-1.52,2.36),.18)
beam('Door lintel',(doorx-.68,-1.52,2.31),(doorx+.68,-1.52,2.31),.2)
# Walls and door are solid separate parts.
stage='03_walls'
box('Left clay wall',(-3.20,.08,1.45),(.16,3.03,2.06),plaster)
box('Rear plank wall',(-1.55,1.63,1.46),(3.22,.15,2.08),wood[1])
box('Tool room right wall',(.1,.28,1.43),(.16,2.61,2.0),wood[1])
for left,right in [(-3.13,doorx-.49),(doorx+.49,.03)]:
 box('Front clay infill',((left+right)/2,-1.4,1.43),(right-left,.14,2.06),plaster)
 for i in range(int((right-left)/.24)):
  x=left+.12+i*.24;box('Front vertical board',(x,-1.49,1.39),(.225,.10,1.96),rng.choice(wood),.015)
for i in range(5):box('Door oak plank',(doorx-.38+i*.19,-1.51,1.25),(.182,.11,1.94),wood[2+i%3],.016)
for z in [.68,1.93]:
 box('Door iron strap',(doorx,-1.593,z),(.82,.045,.077),metal,.012)
 for x in [-.34,0,.34]:
  bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.027,location=(doorx+x,-1.631,z));assign(bpy.context.object,'Iron rivet',metal)
torus('Door ring',(doorx+.22,-1.665,1.18),.09,.017,metal,(math.pi/2,0,0))
# Real triangular gable, filled by individual vertical boards.
for y in [-1.48,1.65]:
 for i in range(14):
  x=-3.13+i*.24;h=1.25*(1-abs(x+1.55)/1.85)
  if h>.03:box('Gable plank',(x,y,2.75+h/2),(.225,.10,h),rng.choice(wood),.015)
# Independent rafters can be exposed during construction.
stage='04_rafters'
for y in [-1.87,-1.22,-.58,.06,.70,1.34,1.99]:
 beam('West roof rafter',(-3.62,y,2.56),(-1.55,y,4.06),.16)
 beam('East roof rafter',(-1.55,y,4.06),(.54,y,2.56),.16)
 beam('Lean-to rafter',(.1,y,3.1),(3.48,y,2.46),.15)
beam('Ridge pole',(-1.55,-2.04,4.09),(-1.55,2.15,4.09),.19)
for x,z in [(-3.57,2.59),(.49,2.59),(3.45,2.47)]:beam('Eave pole',(x,-2,z),(x,2.09,z),.17)
# Closed roof volumes; bundled straw is grouped by overlapping courses.
stage='05_thatch'
def roof_panel(name,a,b,y0,y1):
 a,b=Vector(a),Vector(b);v=Vector((b.x-a.x,0,b.z-a.z));normal=Vector((-v.z,0,v.x)).normalized()
 if normal.z<0:normal=-normal
 pts=[Vector((a.x,y0,a.z)),Vector((b.x,y0,b.z)),Vector((b.x,y1,b.z)),Vector((a.x,y1,a.z))]
 verts=[tuple(p) for p in pts]+[tuple(p-normal*.16) for p in pts]
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]);me.update();o=bpy.data.objects.new(name,me);collections[stage].objects.link(o);o.data.materials.append(straw[1]);be=o.modifiers.new('Soft straw edge','BEVEL');be.width=.06;be.segments=3;o.modifiers.new('Roof normals','WEIGHTED_NORMAL')
 # Tapered individual sheaves share a single mesh for efficient rendering.
 vertices=[];faces=[];mids=[]
 courses=7;n=88
 for row in range(courses):
  t=row/courses
  for i in range(n):
   y=y0+(i+.5)*(y1-y0)/n+rng.uniform(-.009,.009);start=a+v*t+normal*(.095+.01*rng.random());end=a+v*min(1.025,t+1/courses+.047)+normal*.045
   width=(y1-y0)/n*.68;idx=len(vertices)
   for pt,w in [(start,width),(end,width*.76)]:
    vertices.extend([tuple(Vector((pt.x,y-w,pt.z))),tuple(Vector((pt.x,y,pt.z)) + normal*.025),tuple(Vector((pt.x,y+w,pt.z)))])
   faces.extend([(idx,idx+3,idx+4,idx+1),(idx+1,idx+4,idx+5,idx+2)]);mids.extend([rng.randrange(5)]*2)
 me=bpy.data.meshes.new(name+' straw');me.from_pydata(vertices,[],faces);me.update();o=bpy.data.objects.new(name+' straw courses',me);collections[stage].objects.link(o)
 for m in straw:o.data.materials.append(m)
 for f,i in zip(me.polygons,mids):f.material_index=i
roof_panel('West thatch',(-1.55,0,4.10),(-3.7,0,2.61),-1.99,2.09)
roof_panel('East thatch',(-1.55,0,4.10),(.59,0,2.61),-1.99,2.09)
roof_panel('Canopy thatch',(.13,0,3.15),(3.54,0,2.45),-1.99,2.09)
beam('Visible ridge cap',(-1.55,-2.14,4.22),(-1.55,2.25,4.22),.18)
for y in [-2.12,2.17]:
 beam('Crossed ridge pegs',(-1.89,y,4.16),(-1.21,y,4.43),.13)
 beam('Crossed ridge pegs',(-1.88,y,4.44),(-1.22,y,4.16),.13)
 for k in range(5):torus('Ridge rope',(-1.55,y+k*.025,4.25),.16,.017,cloth,(math.pi/2,0,0))
# Equipment and function cues, all independent of the building shell.
stage='06_equipment'
for x in [.93,2.38]:
 for y in [-1.05,-.3]:beam('Bench trestle',(x,y,.1),(x,y,.97),.19)
beam('Bench stretcher',(.89,-1.08,.43),(2.43,-1.08,.43),.17)
rock('Mason working slab',(1.66,-.67,1.04),(1.96,1.15,.27))
beam('Mallet handle',(1.60,-.83,1.2),(1.6,-.83,1.59),.058,mat=wood[3])
box('Mallet head',(1.6,-.83,1.57),(.38,.17,.18),wood[2],.035)
for i in range(2):beam('Stone chisel',(1.94+i*.2,-.98,1.20),(2.08+i*.2,-.46,1.20),.033,mat=metal)
for x,y,z in [(2.84,-.75,.25),(2.89,-.10,.25),(2.86,-.4,.73),(2.76,.57,.28),(2.77,.65,.8),(.7,1.0,.3),(1.3,1.1,.28)]:rock('Finished dressed stone',(x,y,z),(.62,.57,.49))
# Irregular unworked boulder with broad facets.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=(.76,-1.88,.38));o=assign(bpy.context.object,'Unworked limestone',stone[2]);o.scale=(.53,.47,.55)
for v in o.data.vertices:v.co*=rng.uniform(.88,1.10)
for i in range(12):
 x=rng.uniform(.2,2.2);y=rng.uniform(-2.34,-1.91);rock('Stone chip',(x,y,.045),(.10+rng.random()*.09,.07+rng.random()*.08,.075))
# Barrel made of shaped staves and separate hoops.
cx,cy=-3.58,-1.95
for i in range(16):
 a=i*math.tau/16;verts=[]
 for z,r in [(.08,.29),(.2,.34),(.55,.36),(.9,.30)]:
  for b in [a-.18,a+.18]:verts.append((cx+r*math.cos(b),cy+r*math.sin(b),z))
 me=bpy.data.meshes.new('Stave');me.from_pydata(verts,[],[(0,1,3,2),(2,3,5,4),(4,5,7,6)]);me.update();o=bpy.data.objects.new('Barrel stave',me);collections[stage].objects.link(o);o.data.materials.append(rng.choice(wood));mo=o.modifiers.new('Stave thickness','SOLIDIFY');mo.thickness=.04
for z,r in [(.16,.335),(.72,.334),(.88,.301)]:torus('Barrel hoop',(cx,cy,z),r,.025,metal)
cyl('Barrel lid',(cx,cy,.90),.285,.04,wood[2])
# Tool rack and a hanging fabric sunshade.
box('Tool rack',(2.45,-1.75,.37),(.44,.36,.66),wood[2],.03)
for i in range(3):beam('Rack chisel',(2.31+i*.13,-1.76,.40),(2.3+i*.14,-1.76,.95),.041,mat=metal)
verts=[]
for i in range(17):
 t=i/16;x=.37+t*2.45;z=2.38-.25*math.sin(t*math.pi)
 verts.extend([(x,-.9,z),(x,-.91,z-.23-.1*math.sin(t*math.pi))])
me=bpy.data.meshes.new('Hanging linen');me.from_pydata(verts,[],[(i*2,i*2+1,i*2+3,i*2+2) for i in range(16)]);me.update();o=bpy.data.objects.new('Linen valance',me);collections[stage].objects.link(o);o.data.materials.append(cloth);o.modifiers.new('Fabric thickness','SOLIDIFY').thickness=.012
# Master camera and actual projected anchors.
bpy.ops.object.camera_add();cam=bpy.context.object;cam.name='Locked game camera';az,el=map(math.radians,(22.5,28.5));target=Vector((-.10,0,2.30));cam.location=target+Vector((math.cos(el)*math.sin(az),-math.cos(el)*math.cos(az),math.sin(el)))*25;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=11.8;S.camera=cam
bpy.ops.object.light_add(type='AREA',location=(-5,-7,10));bpy.context.object.data.energy=1700;bpy.context.object.data.size=7
S.world.color=(.38,.38,.38);S.render.engine='CYCLES';S.cycles.samples=48;S.cycles.use_denoising=True;S.render.resolution_x=1536;S.render.resolution_y=1024;S.render.resolution_percentage=100;S.render.film_transparent=True;S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA';S.view_settings.view_transform='AgX';S.render.filepath=str(R/'base.png')
bpy.context.view_layer.update()
def project(pt):
 q=world_to_camera_view(S,cam,Vector(pt));return [q.x*1536,(1-q.y)*1024]
a={'doorTop':project((doorx,-1.57,doortop)),'doorFoot':project((doorx,-1.57,doorbottom)),'doorHeightUnits':1.94,'adultHeightUnits':1.78,'cameraElevation':28.5,'cameraAzimuth':22.5,'sourceSize':[1536,1024]};a['doorHeightPixels']=a['doorFoot'][1]-a['doorTop'][1];a['sourceToWorldScale']=96/a['doorHeightPixels']/2
(R/'anchors.json').write_text(json.dumps(a,indent=2));bpy.ops.wm.save_as_mainfile(filepath=str(R/'workshop.blend'));bpy.ops.render.render(write_still=True)
