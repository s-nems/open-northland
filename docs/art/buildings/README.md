# Building assets

| Package | Runtime slot | Tribe / type |
| --- | --- | --- |
| [Basic home](house-1/README.md) | `house-1` | 1 / 2 |
| [Upgraded home](house-2/README.md) | `house-2` | 1 / 3 |
| [Farm](farm/README.md) | `farm` | 1 / 12 |
| [Headquarters](headquarters/README.md) | `headquarters` | 1 / 1 |
| [Stonemason](stonemason/README.md) | `stonemason` | 1 / 29 |

Package-root `runtime.json` files define the current sprites, dimensions, scales,
entrance anchors and construction layers. The game loads exported copies from
`packages/app/src/assets/own/buildings/`.

```sh
npm run art -- build buildings/<slot>
npm run art -- review buildings/<slot>
```

Continue with in-game preview, visual acceptance and publication through the
[shared art pipeline](../PIPELINE.md#package-and-command-contract).

[PIPELINE.md](PIPELINE.md) defines generation, calibration and validation.
Shared Blender and alpha-inspection scripts live in `tools/`.
