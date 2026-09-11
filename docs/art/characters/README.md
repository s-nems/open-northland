# Characters

[Animation board](index.html) · [Production](PIPELINE.md) · [Heads and equipment](MODULARITY.md)

| ID | Appearance |
| --- | --- |
| `man-silver` | Siwy |
| `man-forkbeard` | Dąb |
| `man-redmane` | Ruda grzywa |
| `man-ravenknot` | Krucza kita |
| `woman-blonde` | Blondynka |

`appearances/` owns each character's sources, recipe, layout and sprite strips.
`shared/body/` supplies the male body, textures, cameras and walk calibration.
`shared/motions/` contains idle and construction sources; `equipment/` contains the hammer.
Runtime atlases and role selections live in `packages/app/src/assets/own/characters/`.

Use `assets=own` on a playable map. `ownHead=<id>` previews one appearance;
`selection.json` selects male variants and `job-selection.json` assigns the woman.
Check construction by placing a building. Update the board after exports:

```sh
python3 tools/art-pipeline/authoring/characters/update-character-catalog.py
```
