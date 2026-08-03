# Map name sidecar decodes CP1250 text as Latin-1/UTF-8 mojibake

**Area:** pipeline · **Priority:** P3
**Needs user:** no

`content/maps/tale_of_six_sons_multiplayer.meta.json` carries `"name": "LEGENDA SZEĹšCIU SYNĂ“W"`
(should be `LEGENDA SZEŚCIU SYNÓW`). The Polish source string is CP1250, but the sidecar decode
reads it with the wrong charset, so the menu's map list shows mojibake. Exactly one of the 128
served maps is affected today (verified by scanning every sidecar for `Ĺ`/`Ă` sequences), but any
future Polish-named map with `Ś`/`Ó` outside ASCII hits the same path.

## Scope

Find where the map name/description sidecar text is decoded (the `map.cif` MapInfo join in the
maps stage) and decode region-coded bytes as CP1250 (or the language-appropriate code page) before
emitting JSON. Do not touch already-correct maps.

## Verify

- `npm run test:pipeline` with a synthetic fixture containing `Ś`/`Ó` bytes in CP1250.
- Re-run the pipeline on the owned copy: `tale_of_six_sons_multiplayer.meta.json` reads
  `LEGENDA SZEŚCIU SYNÓW`; the mojibake scan over `content/maps/*.meta.json` finds nothing.
