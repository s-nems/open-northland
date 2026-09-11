"""Measure an in-place walk's planted-ankle travel using Blender, without rendering images."""
import argparse
import hashlib
import json
import os
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy
from blender_common import ORTHO_SCALE, clip_range, goto_frame, import_glb, setup_scene


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    model = Path(args.model)
    scene = setup_scene(512)
    import_glb(str(model))
    armature = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
    start, end = clip_range(list(scene.objects))
    names = ['LeftFoot', 'RightFoot']
    samples = {name: [] for name in names}
    count = 128
    for index in range(count):
        goto_frame(scene, start + (end - start) * index / count)
        for name in names:
            samples[name].append(armature.matrix_world @ armature.pose.bones[name].head)
    speeds = []
    feet = {}
    for name, positions in samples.items():
        threshold = sorted(p.z for p in positions)[count // 4]
        planted = [
            (positions[(i + 1) % count].y - p.y) * count
            for i, p in enumerate(positions)
            if p.z <= threshold and positions[(i + 1) % count].z <= threshold
            and positions[(i + 1) % count].y > p.y
        ]
        if len(planted) < 8:
            raise ValueError(f'Insufficient planted samples for {name}')
        speeds.extend(planted)
        feet[name] = {'samples': len(planted), 'medianTravel': statistics.median(planted)}
    result = {
        'source': os.path.relpath(model.resolve(), Path(args.out).resolve().parent),
        'sha256': hashlib.sha256(model.read_bytes()).hexdigest(),
        'groundTravelPerCycle': statistics.median(speeds),
        'orthoScale': ORTHO_SCALE,
        'sourceBasis': 'Measured approximation: median positive backward Y velocity per normalized cycle, '
                       'ankles in their lowest height quartile; in-place Meshy walk, native bone scales. '
                       'Projection and packing scale must be applied separately. Not root translation.',
        'samplesPerCycle': count,
        'feet': feet,
    }
    Path(args.out).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
