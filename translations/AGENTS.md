# Translation overlays contract

`translations/<lang>/` holds the text the data pack and the catalogue archives do not carry: fan
translations the project imported, and the project's own translations and editorial rewrites. The
pack ships a map with the text its author gave it; an overlay adds or replaces text per key, and the
pipeline and the catalogue API apply overlays as they convert. The schemas live in
`packages/data/src/schema/translations/`; the language codes in `packages/data/src/languages.ts`.

## Layout

```text
translations/
  AGENTS.md                      this contract
  SOURCES.md                     where each imported overlay set comes from: repository, commit,
                                 license, permission; or "machine translation, unreviewed"
  glossary.csv                   the imported term table (names, goods, buildings, tribes); each import
                                 rewrites it whole
  glossary-project.csv           the project's own terms, same columns, edited in place
  <lang>/
    maps/<map>.<map.dat prefix>.json
                                 strings by id, briefing blocks by label  (MapOverlay)
    maps/<map>.<map.dat prefix>.<basis prefix>.json
                                 a further overlay of that map.dat and alias, for a copy with other text
    maps/<name>.edit.json        the project's edit over the imported maps/<name>.json: the keys the
                                 project's corrections changed, in the overlay's language  (MapOverlay)
    objects/<table>.json         goods, houses, jobs, experiences, tribes by type id  (ObjectTableOverlay)
    objects/<table>.edit.json    the project's edit over the imported objects/<table>.json
    names/<pool>.json            one personal-name pool's localized names, by the raw name the pool
                                 spells  (PersonalNameOverlay)
    books/<book>.json            hypertext books: history  (BookOverlay)
    campaigns/<campaign>.json    campaign title  (CampaignOverlay)
    campaigns/<campaign>/films/<slot>.srt
                                 authored film subtitles; intro or seq_0000-style slots
```

A map overlay is named by its `map` alias and the first 16 hex digits of the SHA-256 of the raw
`map.dat`, so one file serves the pack's copy and every catalogue copy of the same map, and a reader
finds a map by its name. The hex part is the identity: the alias may repeat between maps, and the name
must repeat the file's `map` field. Copies of one `map.dat` can ship different text (tribe variants
of one map, a renamed tutorial): a copy with another alias takes its own plain name; a further overlay
of the same language, `map.dat` and alias adds the first 12 hex digits of its `basis.digest`.

## Rules

- An overlay language (`chs`, `cht`) may overlay anything. A source language (`pol`, `eng`, `ger`,
  `rus`) may overlay only a community map (pack provenance `mod` or `user`, or a catalogue archive);
  the pipeline refuses a source-language overlay on a campaign map, on the original game's tutorials
  the mod bundles (`tutorial_001` to `tutorial_007`), on an object table and on a book, because that
  would be a committed copy of the original text. Those keep `tools/asset-pipeline/corrections/`.
- A `names` overlay carries no `basis`: the pools are the project's own independently selected names,
  not text the pack ships, so no source-language text exists for a digest to pin it to. Its file id is
  the pool id it translates, which its `pool` field repeats, and its keys are the raw names the pool
  spells; the audit warns of a key its pool lacks, a typo nothing else would surface. A locale fills as
  much of a pool as it likes, and a name it leaves out keeps the raw one.
- When the pack or archive ships the overlay's language itself, the shipped text wins and the
  translations audit lists the overlay as redundant, unless the overlay's basis is that language.
- An overlay whose basis is its own language is the project's edit of a community map's text: a typo,
  a wrong instruction, a name that disagrees with the rest of the map. It carries only the edited ids
  and labels, each with its whole corrected string or block body.
  [`tools/asset-pipeline/AGENTS.md`](../tools/asset-pipeline/AGENTS.md) lists what stays a correction
  instead. The audit reads the pack as shipped, so an overlay block that a structural correction
  repairs can warn that its tags differ from the source; the pipeline log is the authority for it.
- `basis` records the language and the digest of the decoded source text the overlay was written
  against. A changed source under an unchanged overlay is an audit warning, not a build failure.
- A map takes, per language, the overlay of its `map.dat` whose `basis.digest` matches its own text
  in the basis language. Without a match, the only translation of that language applies, reported
  stale; among several, none applies; an edit (an overlay in its own basis language) applies only on
  a match, since applied elsewhere it would give a copy that ships no such text a fragment of it. A variant name's prefix must begin its `basis.digest`, and two files
  of one language and `map.dat` with the same basis digest fail the load.
- Imported overlays are never edited by hand: fix them upstream and re-import. `SOURCES.md` names the
  upstream commit. The project's own overlays are edited in place.
- An import translates the text as the pack shipped it, so where the project's corrections or
  source-language edits changed that text, the imported overlay still follows the author's version. The
  project's text for those keys goes in `<name>.edit.json` beside the imported `<name>.json`: the same
  schema, only the changed keys, `map` and the file name as the overlay it edits, `basis` the shipped
  text in the language it was translated from. The loader attaches it to the imported overlay and the
  pipeline applies its entries over the overlay's when its basis matches the map's text, else leaves
  it out with a warning. A re-import rewrites `<name>.json` and leaves the edit alone.
- Film subtitles are an explicit exception to the source-language text restriction: independently
  transcribed narration may be committed as SRT, along with its translations. Each spoken language
  uses its own audio timeline; translations use the fallback audio timeline. Keep language-specific
  character names consistent with the campaign strings and record provenance in `SOURCES.md`.
  The JSON overlay importer does not own SRT files. Preserve the contributed native-speaker `chs`
  film subtitles verbatim; corrections belong with their author. Do not add or derive `cht` film
  subtitles. Other subtitle languages are project-edited.
- Overlays are JSON only. Never commit `.ini`, `.hlt`, `.txt` or `.cif` copies of a map's text.
- Every string an overlay changes keeps the source's markup: `@` goal prefixes, `<picture:…>` and
  other tags inside a briefing block, `%s`-style placeholders.

## Tools and checks

`tools/translations/` holds the import from CulturesGameLocalization, the skeleton extractor for a
map archive, the Traditional Chinese derivation and the audit; their commands and flags are in
[DEVELOPMENT.md](../docs/DEVELOPMENT.md#translation-overlays). Two rules follow from them:

- A `cht` file marked `derived: "chs"` is an OpenCC conversion of its `chs` file: edit the `chs` file
  and rerun `npm run translations:derive-cht`, never the derived file. An imported or hand-written
  `cht` file carries no mark and the command keeps it.
- Copies of a map with the same text share one overlay file; the skeleton extractor takes a variant
  name only for other text of the same `map.dat` and alias.

The catalogue API applies the same overlays to catalogue maps ([API](../docs/API.md#translation-overlays)).
