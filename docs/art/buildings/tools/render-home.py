"""Inspect and calibrate a retained Meshy home using measured doorway coordinates."""
import gzip
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
inspection = '--inspect' in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)
with tempfile.TemporaryDirectory(prefix='northland-home-') as temporary:
    compressed = root / 'raw.glb.gz'
    model_path = root / 'raw.glb'
    if compressed.exists():
        model_path = Path(temporary) / 'raw.glb'
        with gzip.open(compressed, 'rb') as source, model_path.open('wb') as target:
            shutil.copyfileobj(source, target)
    bpy.ops.import_scene.gltf(filepath=str(model_path))
scene = bpy.context.scene
meshes = [obj for obj in scene.objects if obj.type == 'MESH']
config_path = root / 'calibration.json'
config = json.loads(config_path.read_text()) if config_path.exists() else {}
if not inspection:
    for obj in meshes:
        obj.scale.y *= config.get('depthScale', 1)
        obj.scale.x *= -1 if config.get('mirrorX', False) else 1
bpy.context.view_layer.update()
points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (low + high) / 2
span = max(high - low)
world = bpy.data.worlds.new('Neutral daylight')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.73, .77, .82, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .75
scene.world = world
for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    nodes = material.node_tree.nodes
    shader = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if shader:
        shader.inputs['Roughness'].default_value = .95
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Specular IOR Level'].default_value = .12
bpy.ops.object.light_add(type='AREA', location=center + Vector((-2, -3, 5)) * span)
light = bpy.context.object
light.data.energy = 180 * span ** 2
light.data.size = span * 3
light.data.shape = 'DISK'
light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'


def point_camera(azimuth, elevation, target):
    az, el = math.radians(azimuth), math.radians(elevation)
    direction = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    camera.location = target + direction * span * 5
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()


def render(name, size):
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.filepath = str(root / name)
    bpy.ops.render.render(write_still=True)


if inspection:
    camera.data.ortho_scale = span * 1.15
    for azimuth, name in [(0, 'front'), (90, 'right'), (180, 'back'), (270, 'left')]:
        point_camera(azimuth, 0, center)
        render(name + '-elevation.png', 900)
    point_camera(22.5, 28.5, center)
    render('inspection.png', 900)
    report = {'boundsMin': list(low), 'boundsMax': list(high), 'center': list(center),
              'orthographicScale': camera.data.ortho_scale, 'imageSize': 900,
              'vertices': sum(len(o.data.vertices) for o in meshes),
              'faces': sum(len(o.data.polygons) for o in meshes)}
    (root / 'inspection.json').write_text(json.dumps(report, indent=2) + '\n')
else:
    config = json.loads((root / 'calibration.json').read_text())
    if 'frontDoorPixels' in config:
        x, y_top, y_foot = config['frontDoorPixels']
        units = config.get('measurementOrthographicScale', span * 1.15) / 900
        door_x = center.x + (x - 450) * units
        door_top = center.z + (450 - y_top) * units
        door_foot = center.z + (450 - y_foot) * units
        origin = Vector((door_x, low.y - span, (door_top + door_foot) / 2))
        hit, location, normal, face, obj, matrix = scene.ray_cast(
            bpy.context.evaluated_depsgraph_get(), origin, Vector((0, 1, 0)))
        if not hit:
            raise ValueError('Door measurement ray misses the model')
        config.update({'doorTop': [door_x, location.y, door_top],
                       'doorFoot': [door_x, location.y, door_foot],
                       'doorGround': [door_x, low.y, low.z],
                       'orthographicScale': span * 1.5,
                       'boundsMin': list(low), 'boundsMax': list(high)})
    top, foot = Vector(config['doorTop']), Vector(config['doorFoot'])
    ground = Vector(config['doorGround'])
    elevation, azimuth = 28.5, 22.5
    camera.data.ortho_scale = config['orthographicScale']
    point_camera(azimuth, elevation, center)
    render('render.png', 1536)
    def project(p):
        q = world_to_camera_view(scene, camera, p)
        return [q.x * 1536, (1 - q.y) * 1536]
    config.update({'cameraElevation': elevation, 'cameraAzimuth': azimuth,
                   'doorTopPixel': project(top), 'doorFootPixel': project(foot),
                   'entrancePixel': project(ground), 'masterSize': [1536, 1536]})
    (root / 'calibration.json').write_text(json.dumps(config, indent=2) + '\n')
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(root / 'house-finished.blend'), compress=True)
