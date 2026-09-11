# Shared male body

`concept/` defines proportions; `model/` contains the rig, walk, run and retargeted idle.
`restyle/` holds painting inputs and `projected/` holds guarded textures.
`cameras-smooth/` and the appearances' layouts fix camera framing and packing scale.
`proportions.json` defines the male silhouette: narrower body and legs, shorter arms and smaller hands.
The renderer applies it after neutral head assembly; source rigs remain reusable.
`walk-gait.json` and `walk-playback.json` define travel calibration and cadence.

The body is an assembly input. Replace its temporary head using an appearance's socket;
see [MODULARITY.md](../../MODULARITY.md) and [export commands](../../PIPELINE.md).
