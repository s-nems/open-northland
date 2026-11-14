# Source data pack

`data.zip` is a source archive, distinct from the generated runtime `content/` tree.
[Development](DEVELOPMENT.md#local-game-content) owns download and local configuration.
The pack is published separately; neither it nor extracted or generated content belongs in Git.

```text
manifest.json
base/                         source data and explicitly selected animation additions
campaigns/<campaign-id>/
  campaign.json
  presentation/               campaign map background, title logos and route overlays (PNG)
  films/                      silent film pictures and per-language sound tracks (WebM)
  maps/<map-id>/
    world/                    shared terrain and world resources
    mission/                  shared mission files
    locales/{pol,eng,ger,rus,ita}/ language-specific text and speech
```

The base tree has these source namespaces:

- `rules/tribes/`, `rules/atomic-animations/`, `rules/types/`, `rules/buildings/` and
  `rules/map-animations/`: readable configuration, owned by the data pack.
- `maps/community/`: bundled community maps, including any narration the pack adds to their
  briefings as `sfx/<language>/NNNN.wav` clips.
- `Data/` and `DataX/`: binary resources and base tables; their internal paths are also stored in
  resource references, so these namespaces retain their source spelling.
- `Usermaps/`: bundled user maps; `extras/`: supplementary source pictures and legacy scenario files.
- `attack-alerts/`: optional; the shouted attack alert takes, an addition the original does not
  have. See [Attack alerts](#attack-alerts).

Text languages are `pol`, `eng`, `ger`, `rus` and `ita`, in `text/<language>/` and
`Data/text/<language>/` folders and campaign `locales/<language>/`. Italian text is CP1252. Italian is
an overlay language the pack also ships: where the pack carries Italian text, it wins over the
repository's `ita` overlays per map, per object-table id, for the history book and for a campaign title
([translations contract](../translations/AGENTS.md)).

The initial materials derive from CNMod 1.3.2. That is provenance, not the pack identity or an
assumption made by the conversion stages. The pack builder translates upstream paths before
publication; the engine reads only the pack layout.

The root manifest has exactly these fields:

- `format`: `open-northland-data`; `version`: `5`; `base`: `base`.
- `components`: records with a stable `id`, `kind` (`base` or `animation`) and source `sha256`.
  Exactly one component is the base. An animation is included only by an explicit release selection.
- `campaigns`: unique campaign ids; empty until campaign sources are prepared.
- `files`: every file except this manifest, with `path`, byte `size` and `sha256`.

Paths are relative, forward-slash separated, without empty segments, parent traversal, drive
prefixes or symlinks. Names must not collide when case-folded. Files not in the inventory and unknown
manifest fields are errors. ZIP entries use UTF-8 names, fixed timestamps, and stored or deflated
compression; ZIP64 is not supported. `scripts/data-pack.mjs` validates this contract.

## Campaigns

The pipeline converts every campaign the manifest lists into `content/`: its maps beside the base maps
and the campaign screen's `campaigns-index.json` ([DATA-FORMAT.md](DATA-FORMAT.md#campaign-manifest)).
`campaign.json` has `version: 2` and describes one original campaign:

| Field | Meaning |
| --- | --- |
| `id`, `campaignId`, `order` | campaign identity, the numeric id its scripts use in `AllowMap`, its place on the campaign screen |
| `title`, `logo` | per-language title text and optional title artwork under `presentation/` |
| `background` | the campaign map picture under `presentation/` |
| `stages` | the selectable stages in play order: the `missionId` slot of the map they open, its point as fractions of the background, and an optional `route` overlay (`file`, `x`, `y`, `width`, `height`) |
| `movies` | per language an optional `intro` and numbered `videos`; each names the shared silent `video` and this language's `audio` under `films/`, with the picture's `width` and `height`; a language without films is omitted |
| `maps` | every map of the campaign, submaps included: an `id`, `shared` files and per-language `locales` |

```json
{
  "version": 2,
  "id": "example",
  "campaignId": 3,
  "order": 1,
  "title": { "pol": "Przyklad", "eng": "Example" },
  "background": "presentation/map.png",
  "stages": [{ "missionId": 10, "x": 0.25, "y": 0.5 }],
  "movies": {},
  "maps": [{
    "id": "campaign_03_01",
    "shared": { "map.dat": "world/map.dat", "mission.inc": "mission/mission.inc" },
    "locales": {
      "pol": { "text/pol/strings.ini": "locales/pol/strings.ini", "sfx/pol/0001.wav": "locales/pol/0001.wav" },
      "eng": { "text/eng/strings.ini": "locales/eng/strings.ini" }
    }
  }]
}
```

Mapping keys are the logical paths the map importer reads inside the map folder; values are paths
under `maps/<map-id>/`. Shared values live under `world/` or `mission/` and never in a language
folder; a locale's keys live under its own `text/<language>/` or `sfx/<language>/` and its values under
`locales/<language>/`, so the languages of one map never collide and the pipeline converts them into
one map. Every map of a campaign carries the same languages, which become the campaign's languages;
a missing language fails instead of falling back. Presentation and film paths are lower-case, since
the app fetches them as `/campaigns/<campaign-id>/<path>`.

A map converts as `<campaign-id>-<map-id>`, so two games' slots never share an id; a clash with a base
map fails the run. Its `map.cif` must name the campaign's `campaignId`, and each stage's `missionId`
must be the slot of one of its maps. Campaign order and progression come from these fields and the
maps' own scripts, never from sorting file names.

## Attack alerts

`base/attack-alerts/alerts.json` lists the alert pools; the takes sit beside it as
`<nation>/<take>.wav`. The pipeline adds each group to the sound bank as a static group and binds
each tribe's two fronts to groups in the IR's `sounds.attackAlerts`. Without the folder the alert
stays silent.

```json
{
  "version": 1,
  "groups": [
    { "name": "Attack Alert Viking Settlement", "volume": 100, "files": ["viking/take-1.wav"] },
    { "name": "Attack Alert Viking Field", "volume": 100, "files": ["viking/take-1.wav", "viking/take-2.wav"] }
  ],
  "tribes": [
    { "tribe": "viking", "base": "Attack Alert Viking Settlement", "units": "Attack Alert Viking Field" }
  ]
}
```

- `groups`: unique names that no `soundfx.cif` group uses; `volume` 0-100 as for a bank static
  group; `files` lower-case `.wav` paths under `attack-alerts/`, one take allowed in several groups.
- `tribes`: a settler tribe as `rules/tribes/tribetypes.ini` names it (the IR `tribes[].id`), at most
  once, with the group for an attack on its settlement (`base`) and on its people in the field
  (`units`). A tribe without a row has no alert.

## Publication identity

`scripts/data-release.json` pins the entire ZIP SHA-256, and the engine downloads exactly that archive
from `https://opennorthland.org/data/<sha256>.zip`. Every published pack stays available under its hash;
`https://opennorthland.org/data.zip` is the current one. A pack is published before the engine pins it.
The pack schema version and runtime IR version are independent. Change the former for an input
layout change and the latter when generated runtime schemas change.

## Derived character libraries

A character library named `<stem>_variant<number>` uses `<stem>`'s armor, weapon and head team-color
layout. Its frames and animation ranges remain independent. Numbered variants allow appearances
to share palette semantics without overwriting another character's sprite library.
