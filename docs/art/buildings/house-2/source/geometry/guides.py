"""Shared straight-roof geometry for consistent house-2 D multiview references."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    return m
wood = material('Warm timber', (.24,.12,.055))
clay = material('Clay infill', (.66,.59,.46))
straw = material('Thatch envelope', (.52,.32,.10))
dark = material('Door recess', (.075,.043,.02))
def box(name, location, dimensions, mat, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    o = bpy.context.object
    o.name = name
    o.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    if bevel:
        mod = o.modifiers.new('Carpentry edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return o
def beam(name, a, b, width=.18):
    a,b = Vector(a),Vector(b)
    o=box(name,(a+b)/2,(width,width,(b-a).length),wood)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return o
def mesh(name, verts, faces, mat):
    m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update()
    o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    return o
# Wall panels are separate from the timber frame. Front doorway is physically open.
box('Rear wall',(0,1.83,1.25),(3.35,.14,2.5),clay)
for x in [-1.67,1.67]:box('Side wall',(x,0,1.25),(.14,3.7,2.5),clay)
box('Front left infill',(-1.4,-1.83,1.25),(.5,.14,2.5),clay)
box('Front right infill',(.825,-1.83,1.25),(1.65,.14,2.5),clay)
box('Door lintel infill',(-.575,-1.83,2.24),(1.15,.14,.52),clay)
for y in [-1.88,1.88]:
    for x in [-1.68,1.68]:beam('Corner post',(x,y,0),(x,y,2.6),.22)
    for z in [.14,.68,2.5]:
        if y < 0 and z < 2:
            beam('Front left crossbeam',(-1.7,y,z),(-1.15,y,z),.19)
            beam('Front right crossbeam',(0,y,z),(1.7,y,z),.19)
        else:
            beam('Gable crossbeam',(-1.7,y,z),(1.7,y,z),.19)
    beam('Gable kingpost',(0,y,2.5),(0,y,4.15),.20)
    for x in [-1.68,1.68]:beam('Gable rafter',(x,y,2.5),(0,y,4.15),.19)
    mesh('Gable clay',[(-1.6,y,2.58),(1.6,y,2.58),(0,y,4.1)],[(0,1,2)],clay)
for x in [-1.7,1.7]:
    for z in [.14,.68,2.5]:beam('Side crossbeam',(x,-1.88,z),(x,1.88,z),.18)
    for y in [-.6,.6]:beam('Side upright',(x,y,.1),(x,y,2.5),.16)
for x in [-1.15,0]:beam('Door jamb',(x,-1.94,.12),(x,-1.94,2.15),.20)
beam('Door lintel',(-1.25,-1.94,2.15),(.1,-1.94,2.15),.21)
box('Recessed door',(-.575,-1.78,1.04),(.95,.1,1.94),wood)
box('Threshold',(-.575,-2.01,.09),(1.12,.38,.18),wood)
box('Closed shutter',(.8,-1.965,1.53),(.65,.13,.70),wood)
for z in [1.24,1.83]:box('Shutter crossbar',(.8,-2.045,z),(.7,.06,.07),dark)
for x in [-1.6,1.6]:
    beam('Front brace',(x,-1.97,2.05),(x+(.42 if x<0 else -.42),-1.97,2.49),.13)
# Continuous planar roof sections, straight level ridge, equal eaves.
for side in [-1,1]:
    verts=[(0,-2.15,4.26),(0,2.15,4.26),(side*2.05,2.15,2.48),(side*2.05,-2.15,2.48)]
    o=mesh('Continuous thatch roof',verts,[(0,1,2,3)],straw)
    mod=o.modifiers.new('Thatch thickness','SOLIDIFY');mod.thickness=.18
beam('Straight ridge binding',(0,-2.25,4.35),(0,2.25,4.35),.24)
for y in [-2.2,2.2]:
    box('Ridge end joint',(0,y,4.35),(.4,.26,.4),wood)

stone=material('Fieldstone',(.39,.40,.38))
for x in [-1.69,1.69]:box('Main stone base',(x,0,.27),(.26,3.9,.54),stone)
box('Rear stone base',(0,1.89,.27),(3.5,.26,.54),stone)
box('Front right stone base',(.87,-1.9,.27),(1.75,.26,.54),stone)
box('Front left stone base',(-1.45,-1.9,.27),(.5,.26,.54),stone)
box('Stone step',(-.575,-2.13,.10),(1.32,.62,.2),stone)
# Right enclosed room; a continuous single-slope roof meets the main right wall.
box('Annex body',(2.22,.25,.97),(1.16,3.28,1.94),clay)
box('Annex stone base',(2.24,.25,.27),(1.26,3.42,.54),stone)
for y in [-1.43,1.93]:
 for x in [1.69,2.84]:beam('Annex post',(x,y,.5),(x,y,1.96),.16)
 beam('Annex sill',(1.69,y,.59),(2.84,y,.59),.16)
box('Annex closed shutter',(2.925,-.35,1.31),(.12,.62,.63),wood)
verts=[(1.50,-1.60,2.68),(1.50,2.13,2.68),(3.08,2.13,1.94),(3.08,-1.60,1.94)]
o=mesh('Annex continuous thatch roof',verts,[(0,1,2,3)],straw)
mod=o.modifiers.new('Annex thatch thickness','SOLIDIFY');mod.thickness=.15

scene=bpy.context.scene
world=bpy.data.worlds.new('Neutral');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.8;scene.world=world
bpy.ops.object.light_add(type='AREA',location=(-4,-6,9));lamp=bpy.context.object;lamp.data.energy=1100;lamp.data.size=6
bpy.ops.object.camera_add();cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=8.2;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1024;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.film_transparent=False;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard'
target=Vector((.5,0,2.05))
for name, angle in [('front',22.5),('right',112.5),('back',202.5),('left',292.5)]:
    az,el=map(math.radians,(angle,20))
    cam.location=target+Vector((math.sin(az)*math.cos(el),-math.cos(az)*math.cos(el),math.sin(el)))*20
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    lamp.location=cam.location+Vector((-4,0,6))
    lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(root/f'guide-{name}.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(root/'reference-geometry.blend'))
