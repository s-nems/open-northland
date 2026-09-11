"""Render construction visibility stages using one camera and fixed geometry."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'workshop-painted.blend'));s=bpy.context.scene;s.cycles.samples=24
names=['01_foundation','02_frame','03_walls','04_rafters','05_thatch','06_equipment']
for stage in [1,2,4]:
 for i,name in enumerate(names):
  for o in bpy.data.collections[name].objects:o.hide_render=i>=stage
 s.render.filepath=str(R/f'stage-{stage}.png');bpy.ops.render.render(write_still=True)
for name in names:
 for o in bpy.data.collections[name].objects:o.hide_render=False
# Consistent reference views from the same solid model, without view-specific front painting.
bpy.ops.wm.open_mainfile(filepath=str(R/'workshop.blend'));s=bpy.context.scene;s.cycles.samples=24;cam=s.camera
for name,angle in [('back',202.5),('left',112.5),('right',292.5)]:
 az,el=map(math.radians,(angle,28.5));target=Vector((-.1,0,2.3));cam.location=target+Vector((math.cos(el)*math.sin(az),-math.cos(el)*math.cos(az),math.sin(el)))*25;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(R/(name+'.png'));bpy.ops.render.render(write_still=True)
