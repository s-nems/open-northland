"""Author reveal timing without changing either sprite's RGB or native alpha."""

import json, shutil, hashlib
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

R = Path(__file__).resolve().parent
body = R / "source" / "paint"
shutil.copyfile(body / "farm-painted.png", R / "farm-painted.png")
shutil.copyfile(R / "frame-render.png", R / "frame.png")
size = 1024
y, x = np.mgrid[:size, :size].astype(float)
frame_time = (
    np.asarray(Image.open(R / "frame-time-render.png").convert("L")).astype(float) / 255
)
# A later crossing member must not cut a hole through an already-visible supporting beam.
for part in json.loads((R / "parts.json").read_text()):
    if part["end"] == 0:
        continue
    a, b = np.array(part["aPixel"]), np.array(part["bPixel"])
    delta = b - a
    t = np.clip(
        ((x - a[0]) * delta[0] + (y - a[1]) * delta[1]) / np.dot(delta, delta), 0, 1
    )
    distance = (x - a[0] - t * delta[0]) ** 2 + (y - a[1] - t * delta[1]) ** 2
    support = distance < (part.get("width", 0.18) * (145 * 1024 / 1254) * 0.55 + 2) ** 2
    earlier = (part["start"] + (part["end"] - part["start"]) * t) / 60
    frame_time[support] = np.minimum(frame_time[support], earlier[support])
Image.fromarray(np.rint(frame_time * 255).astype("uint8")).convert("RGB").save(
    R / "frame-time.png"
)
# These image-space material regions author timing, never silhouette/alpha repairs.
x, y = x * 1254 / 1024, y * 1254 / 1024
side = x > 735
ground = np.where(side, 1150 - (x - 735) * 0.94, 1060 + (x - 302) * 0.214)
height = np.maximum(0, ground - y)
bay = np.where(side, np.floor((x - 735) / 85), np.floor((x - 302) / 108))
body_time = np.clip(0.42 + height / 750 * 0.34 + (bay % 3) * 0.035, 0.42, 0.85)
# The fitted clear doorway stays open until the finishing phase.
door = (x > 437) & (x < 602) & (y > 868 + (x - 437) * 0.21)
body_time[door] = 0.96
lower_roof = np.where(
    x < 510,
    740 + (x - 220) * (-285 / 290),
    np.where(x < 780, 455 + (x - 510) * (390 / 270), 845 - (x - 780) * 0.95),
)
roof = y < lower_roof
ridge_distance = y + x * (350 / 240) - (450 + 510 * (350 / 240))
left = roof & (ridge_distance < 0)
right = roof & ~left
roof_u = 1 - ridge_distance / 770
body_time[right] = 0.72 + np.clip(roof_u[right], 0, 1) * 0.26
left_u = 1 + ridge_distance / 185
body_time[left] = 0.70 + np.clip(left_u[left], 0, 1) * 0.28
body_time[roof & (np.abs(ridge_distance) < 85)] = 0.98
body_time[roof & (y < 260)] = 0.98
body_time = np.ceil(body_time * 50) / 50
for name, t in [("body-time", body_time)]:
    values = np.rint(np.clip(t, 0, 1) * 255).astype("uint8")
    Image.fromarray(values).convert("RGB").save(R / (name + ".png"))
manifest = json.loads((body / "runtime.json").read_text())
manifest["construction"] = [
    {"sprite": "site-base.png", "timeMask": "site-time.png", "fromPct": 0, "toPct": 1},
    {"sprite": "frame.png", "timeMask": "frame-time.png", "fromPct": 0, "toPct": 60},
    {
        "sprite": "farm-painted.png",
        "timeMask": "body-time.png",
        "fromPct": 0,
        "toPct": 100,
    },
]
Image.new("RGB", (size, size), (0, 0, 0)).save(R / "site-time.png")
manifest["sourceBasis"] = manifest["sourceBasis"].split(
    " Construction is an authored approximation:"
)[0]
manifest["sourceBasis"] += (
    " Construction is an authored approximation: separate Blender timber frame, temporary side scaffold, ladder, timber and clay supplies; rendered per-member timing and fitted wall-bay, roof and late doorway timing. Temporary equipment disappears at completion. Both stages retain this exact canvas, scale and entrance. Completed sprite bytes unchanged."
)
(R / "runtime.json").write_text(json.dumps(manifest, indent=2) + "\n")
report = {}
for name in ["site-base.png", "frame.png", "farm-painted.png"]:
    im = Image.open(R / name)
    alpha = np.asarray(im.getchannel("A"))
    report[name] = {
        "size": list(im.size),
        "mode": im.mode,
        "transparent": int((alpha == 0).sum()),
        "partial": int(((alpha > 0) & (alpha < 255)).sum()),
        "opaque": int((alpha == 255).sum()),
        "sha256": hashlib.sha256((R / name).read_bytes()).hexdigest(),
    }
(R / "alpha-report.json").write_text(json.dumps(report, indent=2) + "\n")
