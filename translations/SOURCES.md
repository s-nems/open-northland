# Translation sources

Where each imported overlay set comes from. Imported overlays are regenerated from their source, never
edited by hand ([contract](AGENTS.md)). The `pol`, `eng`, `ger` and `rus` map overlays are not imported:
they are the project's own edits of community maps.

## CulturesGameLocalization: Simplified and Traditional Chinese

| | |
| --- | --- |
| Repository | <https://github.com/HaoJun0823/CulturesGameLocalization> |
| Commit | `f4e4ec6041ca0931b4a7417076e73c7fc05cd038` |
| License | GPL-3.0-or-later; section 13 of the GNU GPL version 3 allows combining it with this repository's AGPL-3.0-or-later code |
| Permission | The project owner confirms that the translation's author gave verbal permission to use these Chinese translations in Open Northland. |

The localization translates the German text, so every overlay's `basis` is our data pack's German
text of the same map, table or book. `cht` is not a separate translation: the upstream author converted
the Simplified text to Traditional script with OpenCC (`s2twp`), as its commits `7e04a91` and `ae4f7a9`
state. Treat it as an automatic conversion, unreviewed.

Imported:

- `chs/` from the `CHN` columns and `Localization/text/l10/`; `cht/` from the `l11` columns and
  `Localization/text/l11/`.
- `<lang>/maps/`: the strings and briefing blocks of each `Localization/map_xml/*.xml` whose
  `map_md5` names a `map.dat` of the pack: the 57 campaign maps and 14 base maps (`tutorial_001` to
  `tutorial_007` and seven community maps). The other 56 XMLs name maps the pack does not ship.
- `<lang>/objects/`: the `goods`, `houses`, `jobs`, `experiences` and `tribes` name tables. House 22
  and tribe 18 are left out: the localization's German names another object under those ids.
- `<lang>/names/`: the `Name` lines of `strings/gameobjects/humannames.ini`, one file per
  personal-name pool, keyed by the raw name the pool generates. `Name 0` and `Name 1` mark the sex
  the line's tribe gives the name, which settles a name that both a male and a female pool carry.
  The pools generate 2341 names and this table translates 282 of them; the rest show their raw
  spelling. Only `humannames.ini` is read: the term table's `人名` rows name the campaign's cast,
  and a row matched to a pool by spelling alone was a guess, not the pool's own text.
- Some entries translate German that `tools/asset-pipeline/corrections/` or our `ger/maps/` overlays
  fix (the tutorials' control instructions, a few goals and object names); the import lists them. The
  project's Chinese for those keys lives in the `<name>.edit.json` files beside the imported files
  ([contract](AGENTS.md)); they are the project's own, written from the project's Polish with the
  imported Chinese as the base, their `cht` twins derived.
- `<lang>/books/history.json`: the blocks of `hypertext/history/mythology.txt`.
- `glossary.csv`: `language_union.csv` with its `ger`, `eng`, `pol`, `l10` (as `chs`) and `l11` (as
  `cht`) columns and the term type, description and references. The import rewrites the whole file.

Not imported: the German, English and Polish text of the XMLs and text folders (the pack carries that
text), the other language columns, `Localization/map_xml_user/` (its maps are not in the pack),
`history.txt` (the pack's history book has no page that includes it), the `.hlt` pages, the GUI and
help tables, `mapdata/`, `OriginalText/`, the movie folders and the tools.

Re-import from a checkout of the repository at the recorded commit, against the unpacked pack:

```sh
npm run import:cultures-localization -- \
  --source ../CulturesGameLocalization --data-root .cache/data/unpacked --out translations
```

The command prints what matched, what it left out and how the localization's German compares with
ours. Update the commit above when importing a newer one.

## Project translations

Overlays the project wrote itself, edited in place:

- `chs/campaigns/` and `cht/campaigns/`: the four campaign titles.
- `glossary-project.csv`: the names and terms of the community maps, written for the project's own
  translation of those maps, in the columns of `glossary.csv`.
- `chs/maps/` files for community maps the import did not cover: the project's translation from the
  Polish text, machine-translated with the glossary and edited by a reviewer; unreviewed by a native
  speaker. Their `cht/maps/` twins are OpenCC conversions (`npm run translations:derive-cht`).


## Campaign film subtitles

`<lang>/campaigns/{asgard,northland,wonder}/films/*.srt` are project-edited subtitles. The initial
English transcription and Simplified Chinese translation were contributed by HaoJun0823. They are
separate from the imported JSON overlays above.

- `eng`, `ger`, `pol`: transcriptions of the corresponding data-pack film audio, checked against two
  ElevenLabs Scribe v2 passes, with targeted Scribe v1 and independent OpenAI transcription checks
  where recognition disagreed. Cue times follow each language's word timestamps; silent passages
  carry no lingering cue. Speech recognition is evidence, not a native-speaker listening review.
- `rus`: project translation of the checked English narration; the pack has no Russian film audio.
- `chs`: HaoJun0823's native-speaker translation, retained verbatim as contributed.
- The Russian translation is AI-assisted and not native-speaker reviewed. There is no `cht` film
  subtitle track; this project does not undertake a Traditional Chinese translation of these films.

Character spellings follow the shipped campaign strings and `glossary.csv`: English **Hatchie**,
German/Polish **Hatschi**, Russian **Хатчи**; **Bjarni**, **Cyra**, **Sigurd** and their localized forms.
The [publisher's Northland synopsis](https://www.application-systems.co.uk/northland/) also confirms
the Saracen identity and the Midgard Serpent; its inconsistent hero spellings do not override the
campaign strings. The English Northland introduction's Saracen epithet is resolved from that context
and the German and Polish narration because automated recognition disagrees on the English word.
