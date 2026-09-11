"""Read-only PNG export diagnostics; passing is not visual approval."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('image', type=Path)
args = parser.parse_args()
with Image.open(args.image) as image:
    alpha = image.convert('RGBA').getchannel('A')
    histogram = alpha.histogram()
    total = image.width * image.height
    errors = []
    warnings = []
    if 'A' not in image.getbands() and 'transparency' not in image.info:
        errors.append('No alpha channel or transparency metadata.')
    if histogram[0] == 0:
        errors.append('No fully transparent background pixels.')
    if histogram[0] == total:
        errors.append('Image is entirely transparent.')
    if histogram[255] == 0:
        warnings.append('No fully opaque pixels; inspect building surfaces for translucency.')
    bounds = alpha.getbbox()
    if bounds and (bounds[0] == 0 or bounds[1] == 0 or bounds[2] == image.width or bounds[3] == image.height):
        warnings.append('Nonzero alpha reaches canvas boundary; inspect clipping and margin.')
    print(json.dumps({
        'file': args.image.name,
        'sha256': hashlib.sha256(args.image.read_bytes()).hexdigest(),
        'mode': image.mode,
        'size': list(image.size),
        'alphaBounds': bounds,
        'transparentPixels': histogram[0],
        'partialAlphaPixels': sum(histogram[1:255]),
        'opaquePixels': histogram[255],
        'errors': errors,
        'warnings': warnings,
        'status': 'rejected-export' if errors else 'requires-visual-review',
    }, indent=2))
    raise SystemExit(1 if errors else 0)
