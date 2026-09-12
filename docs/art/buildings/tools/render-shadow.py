"""Render a separate shadow from retained building geometry and doorway registration."""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
config = json.loads((root / 'calibration.json').read_text())
manifest = json.loads((root / 'runtime.json').read_text())
model = root / config['model']
bpy.ops.wm.open_mainfile(filepath=str(model))
scene = bpy.context.scene
camera = scene.camera
models = [obj for obj in scene.objects if obj.type == 'MESH']
rotation = Matrix.Rotation(math.radians(config.get('modelRotationDegrees', 0)), 4, 'Z')
for obj in models:
    obj.matrix_world = rotation @ obj.matrix_world
bpy.context.view_layer.update()
right = camera.rotation_euler.to_matrix() @ Vector((1, 0, 0))
up = camera.rotation_euler.to_matrix() @ Vector((0, 1, 0))
forward = camera.rotation_euler.to_matrix() @ Vector((0, 0, -1))
elevation = math.radians(28.5)
if 'doorGround' in config:
    door_ground = Vector(config['doorGround'])
    door_height = config['doorHeight']
else:
    source_width = scene.render.resolution_x
    source_height = scene.render.resolution_y
    units_per_pixel = camera.data.ortho_scale / source_width
    x, y = config['referenceEntrance']
    ray = camera.location + right * ((x - source_width / 2) * units_per_pixel)
    ray += up * ((source_height / 2 - y) * units_per_pixel)
    door_ground = ray + forward * ((config['groundZ'] - ray.z) / forward.z)
    door_height = config['referenceDoorPixels'] * units_per_pixel / math.cos(elevation)
width, height = config['imageSize']
scene.render.resolution_x = width
scene.render.resolution_y = height
scene.render.resolution_percentage = 100
camera.data.ortho_scale = door_height * math.cos(elevation) * width / config['doorPixels']
bpy.context.view_layer.update()
projected = world_to_camera_view(scene, camera, door_ground)
current = Vector((projected.x * width, (1 - projected.y) * height))
anchor = manifest['shadow']['entrancePixel']
delta = Vector((anchor['x'], anchor['y'])) - current
camera.location += (-delta.x * right + delta.y * up) * camera.data.ortho_scale / width
bpy.context.view_layer.update()
for obj in models:
    obj.visible_camera = False
for obj in list(scene.objects):
    if obj.type == 'LIGHT':
        bpy.data.objects.remove(obj, do_unlink=True)

# Rotate daylight with the camera to preserve the same screen-space direction.
light_rotation = Matrix.Rotation(math.radians(config.get('lightRotationDegrees', 0)), 3, 'Z')
incoming = light_rotation @ Vector((5, 8, -14))
bpy.ops.object.light_add(type='SUN')
sun = bpy.context.object
sun.rotation_euler = incoming.to_track_quat('-Z', 'Y').to_euler()
sun.data.energy = 2.0
sun.data.angle = math.radians(9)
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.73, .77, .82, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .7
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, door_ground.z - .005 * door_height / 1.94))
catcher = bpy.context.object
catcher.name = 'Ground shadow catcher'
catcher.is_shadow_catcher = True
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
tree = bpy.data.node_groups.new('Shadow opacity', 'CompositorNodeTree')
scene.compositing_node_group = tree
tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
render = tree.nodes.new('CompositorNodeRLayers')
set_alpha = tree.nodes.new('CompositorNodeSetAlpha')
set_alpha.inputs['Type'].default_value = 'Apply Mask'
set_alpha.inputs['Alpha'].default_value = .48
tree.links.new(render.outputs['Image'], set_alpha.inputs['Image'])
composite = tree.nodes.new('NodeGroupOutput')
tree.links.new(set_alpha.outputs[0], composite.inputs[0])
scene.render.filepath = str(root / 'shadow.png')
bpy.ops.render.render(write_still=True)
report = {
    'blenderVersion': bpy.app.version_string,
    'modelSha256': hashlib.sha256(model.read_bytes()).hexdigest(),
    'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'calibrationSha256': hashlib.sha256((root / 'calibration.json').read_bytes()).hexdigest(),
    'shadowSha256': hashlib.sha256((root / 'shadow.png').read_bytes()).hexdigest(),
    'cameraElevationDegrees': 28.5,
    'sunIncomingDirection': list(incoming),
    'sunAngularDiameterDegrees': 9,
    'opacity': .48,
    'samples': 32,
}
(root / 'render.json').write_text(json.dumps(report, indent=2) + '\n')
