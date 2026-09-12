"""Export reveal timing and metadata while preserving generated body alpha."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
calibration = json.loads((ROOT / 'calibration.json').read_text())
y, x = np.mgrid[:1024, :1024]
ground = np.interp(x, [0, 200, 350, 590, 740, 900, 1023], [760, 800, 890, 925, 925, 790, 760])
wall_height = np.maximum(0, ground - y)
timing = np.clip(.42 + wall_height / 360 * .22 + (x // 90 % 3) * .018, .42, .68)
eave = np.interp(x, [92, 160, 250, 340, 430, 560, 650, 760, 840, 968], [455, 525, 605, 570, 575, 600, 625, 650, 570, 460])
roof = y < eave
timing[roof] = .72 + np.clip((eave[roof] - y[roof]) / (eave[roof] - 80), 0, 1) * .27
interior = (x > 377) & (x < 568) & (y > 610) & (y < 894)
timing[interior] = .98
Image.fromarray(np.rint(np.ceil(timing * 50) / 50 * 255).astype('uint8')).convert('RGB').save(ROOT / 'body-time.png')
Image.new('RGB', (1024, 1024), (0, 0, 0)).save(ROOT / 'site-time.png')
manifest = {
    'tribeId': 1, 'typeId': 12, 'layer': 'own-farm', 'sprite': 'farm-painted.png',
    'width': 1024, 'height': 1024, 'scale': calibration['scale'],
    'entrancePixel': dict(zip(('x', 'y'), calibration['entrance'])),
    'doorNode': {'x': -1, 'y': 1},
    'selectionEllipse': {'cx': 545, 'cy': 817, 'rx': 350, 'ry': 105},
    'sourceBasis': 'Independent selected woven grain-drying farm E. Meshy7 reconstruction, Blender orthographic camera at28.5deg elevation/25deg azimuth, built-in imagegen paintover with canonical muted House A, GPT Image1.5 genuine-alpha export. Manual clear door296+/-8px targets96px at zoom2 beside88px actor. Original local reference canvas129x150 used for approximate overall size only. Tribe1/type12 and door(-1,1) verified in owned houses.ini and content/ir.json; simulation geometry unchanged. Authored timber frame and material-region reveal timing approximate construction; frame camera shifted upward50px to register export. Separate model-derived shadow. Generated body alpha preserved without keying or authored silhouette masks.',
    'construction': [
        {'sprite': 'site-base.png', 'timeMask': 'site-time.png', 'fromPct': 0, 'toPct': 1},
        {'sprite': 'frame.png', 'timeMask': 'frame-time.png', 'fromPct': 0, 'toPct': 60},
        {'sprite': 'farm-painted.png', 'timeMask': 'body-time.png', 'fromPct': 0, 'toPct': 100},
    ],
    'shadow': {'sprite': 'shadow.png', 'width': 1664, 'height': 1152, 'entrancePixel': {'x': calibration['entrance'][0] + 128, 'y': calibration['entrance'][1]}},
}
(ROOT / 'runtime.json').write_text(json.dumps(manifest, indent=2) + '\n')
shadow = ROOT / 'shadow'
shadow.mkdir(exist_ok=True)
(shadow / 'runtime.json').write_text(json.dumps(manifest, indent=2) + '\n')
(shadow / 'calibration.json').write_text(json.dumps({
    'model': '../calibrated.blend',
    'referenceEntrance': calibration['modelReferenceEntrance'],
    'referenceDoorPixels': calibration['modelReferenceDoorPixels'],
    'groundZ': 0,
    'doorPixels': calibration['doorPixels'],
    'imageSize': [1664, 1152],
    'samples': 128,
    'alphaFloor': .04,
    'bodyPadding': [128, 0],
    'basis': 'Retained own farm geometry; manual registration from calibrated render to final painted doorway. Shared artistic daylight.',
}, indent=2) + '\n')
