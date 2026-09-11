# Grass and flowers

Six grass patches and two flower patches are cropped from `atlas-alpha.png`. `asset.json` preserves
original frame dimensions and anchors at two source pixels per world pixel. Per-prop renderer
brightness is 0.76 for ordinary grass/flowers, 0.55 for dark grass and 0.40 for deep grass. Ferns
have a separate [fern pack](../ferns/README.md).

Run `npm run art -- build terrain/meadows`, then `npm run art -- review terrain/meadows`. Publish the approved candidate with `npm run art -- publish terrain/meadows`.
