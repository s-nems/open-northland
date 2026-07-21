# Pipeline: skip the ghost "text" map from a stray map.dat inside a text/ subfolder

**Area:** pipeline · **Priority:** P2

## Problem

The menu lists a map card titled `text`. The pipeline's map discovery converts every `**/map.dat`,
and `CnModMaps/WICHRY_ZIMY/text/` (the map's string-table subfolder) contains a stray copy of
`map.dat` (plus `mission.inc`), so it is converted as a map of its own with id `text`
(`content/maps/text.json` + `text.script.json`, no meta, 0 players). The real `WICHRY_ZIMY` map
converts normally beside it.

## Task

Skip map candidates whose folder is a `text`/`Text` string-table subfolder of another map folder
(a folder containing `map.dat` one level up), or dedupe by map GUID (`[logiccontrol]` `mapguid`)
so an author's stray copy never becomes a second menu entry. Add a synthetic-fixture test and
verify with a real pipeline run that `content/maps/text.*` disappears and the map count drops by
exactly one.

## Notes

- Source basis, owned copy: `CnModMaps/WICHRY_ZIMY/text/map.dat` is byte-identical in purpose to
  a string-table folder; no other corpus folder ships a stray `map.dat` this way (checked 2026-07-17).
- Unverified, adjacent observation: the menu name "LEGENDA SZEŁśCIU SYNÓW" (`Data/maps` corpus)
  looks mojibake ("SZEŚCIU"); check whether the map's own string table is authored that way before
  touching the CP1250 decode.
