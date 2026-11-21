# Map folders and `opennorthland.json`

A map is a folder. Open Northland reads the original game's layout unchanged, so every map made for
the original still loads, and adds one file of its own, `opennorthland.json`, for rules the original
script cannot express. The schemas are the authority: `packages/data/src/map-modules/` for the file
and its modules, `packages/map-import/src/layout.ts` for the folder.

## The folder

| File | Role |
| --- | --- |
| `map.dat` | terrain, landscape objects and height ([MAPDAT.md](MAPDAT.md)) |
| `map.cif` | the packed script: players, missions, placed objects, AI rows ([CIF.md](CIF.md)) |
| `map.ini`, `mission.inc`, `staticobjects.inc`, `ai.inc`, `player.inc`, `misc.inc` | the same script as the editor's text files, read when the folder has no `map.cif` ([MISSIONS.md](MISSIONS.md)) |
| `text/<lang>/strings.ini` or `strings.cif` | the map's string table per language |
| `text/<lang>/briefings/` | `briefings.txt` blocks and the `NNNN.hlt` pages a `PlayCutscene` opens |
| `sfx/<lang>/NNNN.wav` | a briefing page's spoken line |
| `minimap/minimap.pcx` | the menu picture |
| `opennorthland.json` | what this engine adds (below) |

The text form and the packed form convert to the same documents, so a map kept as text is edited with
a text editor: a mission's time, a seat's `playeroption`, a placed settler. Text files are read as
CP1250, `text/rus` as CP1251 and `text/ita` as CP1252. A file the importer does not know is ignored.

The map's id comes from its folder name (lower-cased, runs of other characters as `_`), or from the
import that installs it. Nothing inside the folder names the map's identity.

## `opennorthland.json`

UTF-8 JSON, strict: an unknown key, a wrong type or a value out of its bounds refuses the whole map
with the reason, because a mode converted without its rules would be another map under the same
name. A reader accepts exactly its own `version`.

```json
{
  "version": 1,
  "mode": { "of": "SPECJALNA- FORTECA", "name": 3, "detail": 4 },
  "roomDefaults": { "oreYield": 3 },
  "modules": { "siege": { "version": 1, "...": "..." } }
}
```

| Key | Meaning |
| --- | --- |
| `version` | `1` |
| `mode` | this map is another map played by other rules: `of` is that map's folder name, `name` and `detail` are ids in this map's own string table (the mode's name and one line about it) |
| `roomDefaults` | the room settings a lobby starts at when the map is chosen; the host may change them. `oreYield`: the ore richness factor, 2, 3 or 5 |
| `objects` | edits to the landscape objects `map.dat` places, applied in order as the map is read: each names a half-cell node `hx`/`hy`, what it holds now (`from`) and what it gets (`to`), each `null` or `{ "type": <EditName>, "level": <level>, "owner": <player slot or null> }`. A node holding anything but `from`, a node off the map or a `to` type the map does not already place refuses the map. For what a script cannot place, such as an owned wall post |
| `modules` | rules the simulation runs over the map's script (below) |

Every key but `version` is optional. Every string id the file names must exist in the map's string
tables; every seat must be in the script's roster; every point must lie on the map. These are checked
at import. Content names (jobs, tribes, buildings, goods, vehicles, by their slug in the game's data)
are checked when the world is assembled, where the content is known.

### Modes in the menu

A mode whose base map is listed from the same source shows under the base map's tile as a switch
named by `mode.name`; all switches off plays the base map. A mode without its base map in the same
source, such as a locally imported copy, is listed as a map of its own under its own name.

### Modules

Each module stands alone, carries a `version` of its own and changes nothing when absent. Times are
seconds of game time from match start; points are half-cell nodes, as the script's own AI rows name
them. The exact fields and bounds are in `packages/data/src/map-modules/schema.ts`.

| Module | What it does |
| --- | --- |
| `siege` | A stronghold seat keeps a growing guard at its keep and sends attacks against every occupied target seat, both of the soldier trades in `jobMix` (another trade sends nobody): `attacks.launches` at fixed times, then `attacks.repeat`; each target names the raider seat that attacks it, the point its men march on and its sea landings. Optional parts: `landings` (ships), `catapults` (lost ones return), `builders`, `porters`, `towerGarrison` |
| `gearSchedule` | At each step every soldier of the listed seats gets the step's goods and weapon upgrades, as does every soldier those seats create later |
| `heroes` | Defenders placed once at match start, with hitpoints, equipment, a name from the string table and an optional drawn size |
| `deathDrops` | Fallen characters of the listed seats drop nothing |
| `demobilizedStart` | Every soldier of a computer-run seat starts as a civilian |

A notice (`{ "title": <string id>, "detail": <string id> }`) is shown centre-screen in the map's own
words when its event happens.

The bounds cap what one beat may ask of the simulation (men per spawn, men per attack, the shortest
pulse), since a map can come from anywhere. They do not cap how many men a long match gathers.

## Identity and delivery

- The modules are part of the map's script document, so the map's fingerprint covers them: two
  players start a match only on the same script and the same modules.
- A save records the fingerprint of the modules it was made under and loads only under the same ones.
- A map a player lacks reaches them from the room with its documents: terrain, script, string table,
  briefing pages and meta. The fingerprint covers terrain and script; a player who already holds the
  map under the same fingerprint reads the words of their own copy. A locally imported map is also kept by the relay for members who join
  later; a map of the base game is never sent.

## Changing a rule

Edit the folder, import it in the menu (it is listed as your own map), host a room on it. Nothing in
the game build changes. A module revision the build does not know refuses the map with a message
naming the key.
