"""Review delivered native layers at five progress values without changing source assets."""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
manifest = json.loads((root / "runtime.json").read_text())
size = manifest["width"]
board = Image.new("RGB", (1800, 560), (103, 118, 86))
draw = ImageDraw.Draw(board)
for column, progress in enumerate([15, 35, 55, 80, 100]):
    image = Image.new("RGBA", (size, size))
    for stage in manifest["construction"]:
        if progress == 100 and stage["sprite"] != manifest["sprite"]:
            continue
        pixels = np.array(Image.open(root / stage["sprite"]))
        timing = np.array(Image.open(root / stage["timeMask"]))[:, :, 0]
        threshold = min(255, round(round(progress / stage["toPct"] * 255) / 4) * 4)
        pixels[timing > threshold, 3] = 0
        image.alpha_composite(Image.fromarray(pixels))
    image.save(root / f"preview-{progress}.png")
    image.thumbnail((360, 510), Image.Resampling.LANCZOS)
    board.paste(image, (column * 360, 45), image)
    draw.text((column * 360 + 160, 530), f"{progress}%", fill="white")
board.save(root / "stages.png")
