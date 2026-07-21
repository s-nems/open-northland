# Exclude string-table folders from map discovery

**Area:** pipeline · **Priority:** P2

The menu lists a map card titled `text`. The pipeline's map discovery converts every `**/map.dat`,
and `CnModMaps/WICHRY_ZIMY/text/` (the map's string-table subfolder) contains a stray copy of
`map.dat` (plus `mission.inc`), so it is converted as a map of its own with id `text`
(`content/maps/text.json` + `text.script.json`, no meta, 0 players). The real `WICHRY_ZIMY` map
converts normally beside it.

## Scope

Skip map candidates whose folder is a `text`/`Text` string-table subfolder of another map folder
(a folder containing `map.dat` one level up), or dedupe by map GUID (`[logiccontrol]` `mapguid`)
so an author's stray copy never becomes a second menu entry. Add a synthetic-fixture test and
verify with a real pipeline run that `content/maps/text.*` disappears and the map count drops by
exactly one.

Source basis: the owned copy has `CnModMaps/WICHRY_ZIMY/text/map.dat` under the real map, and no other
string-table folder in the corpus becomes a map candidate.

## Verify

Run the synthetic discovery test and `npm run test:pipeline`; the ghost outputs disappear and the
real `WICHRY_ZIMY` map remains.
