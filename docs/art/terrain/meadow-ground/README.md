# Meadow ground

`quiet.png` and `dark.png` provide meadow ground as 512×512 panels of `master.png`.
`materials.json` selects ordinary, dark and deep meadow, earth, clay and supported transitions.

Clay uses the selected independent olive-brown painting in `source/clay/master.png`, exported to
`source/clay/texture.png` at 512×512. Its prompt and generation record live beside the source.
The opaque material retains neutral runtime tint, the shared-edge patches sampler, pages
`text_210`–`text_213` and transitions `mud 1` / `mud 2`, verified against owned CIF records and local IR.
Painted detail and boundary blending remain artistic approximations.

Build with `npm run art -- build terrain/meadow-ground` and review with
`npm run art -- review terrain/meadow-ground`. The selected ground and companion
[clay deposits](../clay/README.md) were accepted on Magiczny Las at zooms 1 and 2:
`?map=magiczny_las&assets=own&intro=off&zoom=2&center=34,35&fog=off`.
