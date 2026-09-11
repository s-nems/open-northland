"""Calibrated matte sprite renders from the full-detail Meshy reconstruction."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

root=Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'raw.glb'))
s=bpy.context.scene
model=[o for o in s.objects if o.type=='MESH']
# Manual clear-opening endpoints in the straight-on 1100px / 2.2-unit elevation.
door_top_raw=-.100
door_foot_raw=-.836
door_x_raw=-.210
door_y_raw=-.790
factor=1.94/(door_top_raw-door_foot_raw)
ground_raw=-.9185969829559326
for o in model:
    o.scale*=factor
    o.location.z-=ground_raw*factor
    o.name='House A — Meshy 7 full-detail exterior'
bpy.context.view_layer.update()
def point(raw):
    return Vector((raw[0]*factor,raw[1]*factor,(raw[2]-ground_raw)*factor))
foot=point((door_x_raw,door_y_raw,door_foot_raw))
top=point((door_x_raw,door_y_raw,door_top_raw))
mixes=[]
for m in model[0].data.materials:
    nt=m.node_tree
    shader=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Roughness'].default_value=.95
    shader.inputs['Metallic'].default_value=0
    shader.inputs['Specular IOR Level'].default_value=.12
    tex=next(n for n in nt.nodes if n.type=='TEX_IMAGE')
    tex.interpolation='Linear'
    out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
    emission=nt.nodes.new('ShaderNodeEmission');emission.name='Preserve painted base color'
    nt.links.new(tex.outputs['Color'],emission.inputs['Color'])
    mix=nt.nodes.new('ShaderNodeMixShader');mix.name='Painted texture / matte lighting'
    nt.links.new(shader.outputs[0],mix.inputs[1]);nt.links.new(emission.outputs[0],mix.inputs[2]);nt.links.new(mix.outputs[0],out.inputs['Surface'])
    mixes.append(mix)
world=bpy.data.worlds.new('Neutral soft daylight');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.73,.77,.82,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.75;s.world=world
target=Vector((0,0,2.45))
bpy.ops.object.light_add(type='AREA',location=(-5,-8,11));light=bpy.context.object
light.data.energy=1100;light.data.size=7;light.data.shape='DISK'
light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();cam=bpy.context.object;cam.name='House sprite orthographic 28.5 / 22.5';cam.data.type='ORTHO';s.camera=cam
elevation=math.radians(28.5)
cam.data.ortho_scale=1.94*math.cos(elevation)*512/96
def camera(angle):
    az=math.radians(angle)
    cam.location=target+Vector((math.sin(az)*math.cos(elevation),-math.cos(az)*math.cos(elevation),math.sin(elevation)))*22
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
camera(22.5)
s.render.engine='CYCLES';s.cycles.samples=48
s.render.resolution_x=512;s.render.resolution_y=512;s.render.resolution_percentage=100
s.render.film_transparent=True;s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.view_settings.view_transform='Standard'
def render(name,size=512):
    s.render.resolution_x=size;s.render.resolution_y=size
    s.render.filepath=str(root/name);bpy.ops.render.render(write_still=True)
for weight,label in [(0,'matte'),(.35,'balanced'),(1,'painted')]:
    for mix in mixes:mix.inputs[0].default_value=weight
    render(f'look-{label}.png')
for mix in mixes:mix.inputs[0].default_value=.35
render('house-final.png',1536)
render('house-sprite.png')
def project(p):
    q=world_to_camera_view(s,cam,p)
    return [q.x*512,(1-q.y)*512]
calibration={'basis':'Manual clear-opening reading in front-elevation.png at x450: y600 to y968; approximate ±4 elevation pixels. Geometry guide dimensions are artistic targets.', 'raw_door_height':door_top_raw-door_foot_raw,'model_scale':factor,'door_height_design_units':1.94,'adult_height_design_units':1.78,'camera_elevation':28.5,'camera_azimuth':22.5,'orthographic_scale':cam.data.ortho_scale,'sprite_size':[512,512],'master_size':[1536,1536],'door_top_sprite':project(top),'door_foot_sprite':project(foot),'ground_entrance_anchor_sprite':project(point((door_x_raw,door_y_raw,ground_raw))),'door_screen_px_target':96,'actor_screen_px_target':88,'world_zoom':2,'source_to_world_scale':.5,'runtime_integrated':False}
(root/'calibration.json').write_text(json.dumps(calibration,indent=2))
for angle,label in [(112.5,'right'),(202.5,'back'),(292.5,'left')]:
    camera(angle);render(f'finished-{label}.png',768)
camera(22.5)
s.render.resolution_x=1536;s.render.resolution_y=1536;s.render.filepath=str(root/'house-final.png')
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(root/'house-finished.blend'))
