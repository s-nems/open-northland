# Viking farm

Runtime slot `farm`: tribe 1 / type 12.
[Manifest](runtime.json) · [Sprite](farm-painted.png) · [Preview](index.html)

`build-frame.py` and `site_details.py` generate the structural layers.
`export.py` reads the static painting and calibration from `source/paint/` and writes the construction bundle.
`source/geometry/` contains the Meshy model, calibrated scene and projection scripts.
`render.py` creates `farm.blend`; `calibrate.py` creates `calibrated.blend`.

Export and review procedure: [PIPELINE.md](../PIPELINE.md).
