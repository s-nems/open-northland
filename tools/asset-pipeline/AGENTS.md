# Asset pipeline contract

The pipeline validates an unpacked source data pack and converts its base tree and campaigns into local
runtime content. `docs/DATA-PACK.md` owns the archive and campaign contract. It runs only under
Node: stages read the data and write the output tree through `node:fs` directly, and `src/files.ts`
holds the shared helpers (parent-creating writes, tolerant `stat`, the file walk). Compression and
floating-point image work are fine. The sim determinism restrictions do not apply, but root legal,
source, readability, and verification rules do.

The output tree is served as static files, so every served directory is named once, after the URL
root the app fetches it at (`stages/content-tree.ts`, or the stage that owns the directory), files the
IR references are written lower-cased like the references, and a stage writes only what the app
fetches: intermediates stay in memory. The pack's resource subtrees are named in `roots.ts`, shared rule paths in `data-layout.ts`.

## Source discipline

- Prefer readable rule `.ini`, then readable base `.ini`, then decoded `.cif`.
- Inspect the real source, decoder, and generated `ir.json` before changing a join.
- Treat keys as case-sensitive. Repeated keys and one-line lists need distinct helpers.
- Check whether numeric ids are globally unique or scoped before building an index.
- Never use another engine implementation as source evidence.

Provenance fields currently record source file, optional block, and layer where the schema supports
them. Do not claim provenance fields that the schema does not store. Keep full field mapping in the
decoder and its tests.

## Corrections

`corrections/<id>.json` fixes an authoring error in one source file that no data rule can express, such
as a map script that swaps two seats' gathering points. The file names the data-relative path (for a
campaign map's file, its tree path `campaigns/<campaign>/<map>/<logical path>` under the folder the
map's `provenance.folder` names), the SHA-256 of the shipped file, and whole-line `from`/`to` swaps (a
list in `to` replaces the line with several, an empty list deletes it; `"every": true` when the line
repeats and each copy takes the same fix; `"section"` naming a unique line to confine the swap to its
`[...]` block when the line repeats across records; `"line"` naming the one line by number when
identical lines need different fixes), with a `reason` in Polish for the owner reviewing the list.
`"encoding"` (an ASCII-compatible `TextDecoder` label) reads `from` and writes `to` lines outside ASCII
in that code page, such as a briefing's text; without it both stay printable ASCII. The stage reading
the file goes through `readSourceFile`, which applies the swaps only while the hash still matches.

A text edit of a community map (a base map under `maps/community/`) is a same-language translation
overlay, not a correction; [`translations/AGENTS.md`](../../translations/AGENTS.md) owns it. A
correction keeps:

- the text of a campaign map and of the original game's tutorials the mod bundles under
  `maps/community/` (`tutorial_001` to `tutorial_007`), which is original text no source-language
  overlay may carry; `stages/maps/provenance.ts` names them;
- a structural repair of a `briefings.txt`: a duplicated, missing or misspelt `[blockstart:…]` or
  `[blockend:…]` marker, a stray character after one, a block split in two, a broken `<picture:…>`
  tag. A file that also edits prose keeps only the repair, re-pinned to the same hash, and the edited
  blocks go to the overlay;
- the text of a community map whose `map.dat` and text another map folder shares, since an overlay
  applies to every copy that ships the text it was written against;
- scripts, `map.cif`, `map.dat`, `.inc` and rule files, and the display tables (`strings/tables.json`).

A correction the run did not apply fails the pipeline, including after a data release changes the
file: check whether the data now fixes it, then delete the file or re-pin its hash. Deleting the file
removes the correction. Behavior differences from the original stay in code and docs, not here.

An encrypted map script can use `"format": "cif"` in its source correction. Its hash still pins the raw
file bytes. Each edit requires `"line"`, the 1-based position in `decodeCifStringArray(...).lines`,
and exact ASCII `from`/`to` property text; only level-2 properties can change. The normal map decoder
applies these edits before any sections are read, without rewriting the binary. Reading the source
bytes alone does not mark a CIF correction applied. A hash, line or level mismatch fails the run.
The callback names the source tree's folder path, independent of a map's published id.

A `map.dat` correction uses `"format": "mapdat"` and lists `objects` instead of `lines`: each edit names
a half-cell node `hx`/`hy`, the object it holds now (`from`) and the one it gets (`to`), each `null` or
`{"type": <EditName>, "level": <lmlv>, "owner": <lmlp slot or null>}`. The hash pins the raw file; the
map converter edits the decoded landscape objects, never the binary, and a node holding anything but
`from`, a node off the map or a `to` type the map does not already place fails the run. Use it for a
misplaced or missing authored object, such as a gap in a wall line.

`corrections/strings/tables.json` is the one place for display-string fixes in all four languages,
whether the table ships as `.ini` or `.cif`. Each entry names `lang`, `table` (its key in
`gui/strings/<lang>.json`, or `goodsHelp` / `housesHelp` for the two tables of `gui/help/<lang>.json`),
the string `id`, the exact decoded `from` text (game-object names and help text arrive trimmed, with
single spaces, a help text's line breaks as `\n`), our `to` text and a Polish `reason`. The strings stage swaps the text
only while it still reads `from`, and an entry the run did not apply fails the pipeline the same way,
so a data release that fixes the text forces its removal.

A `goodsHelp` / `housesHelp` entry quotes as little as it can: its `from` is a phrase that occurs exactly
once in the text, kept as short as that allows, and `to` replaces that phrase alone. Several entries may
name one id; they apply in file order, each to the text the one before left, and a phrase that is
missing or occurs twice leaves its entry unapplied. Only a text rewritten whole quotes the whole text.

A map-string entry may use `"from": null` to add a missing id in an existing language table. It applies
only if that id is absent; an occupied id, even one already reading `to`, fails the correction check.
It never creates a missing language table. GUI table entries still require an existing `from` string.

`corrections/strings/maps.json` does the same for a map's own strings (`maps/<map>.strings.json`), such
as mission goals kept in an encrypted `text/<lang>/strings.cif` that no line swap can reach. Each entry
names `map` (the map id) instead of `table`; the maps stage swaps the decoded text before the meta,
script and strings files read it, under the same `from` check and the same failure rule. A community
map's entry is either an added id, which an overlay cannot add without the translations audit
reporting a key the source lacks, or a map whose text no overlay may carry (above); its other string
edits belong in its overlay.

## Decoder work

The decoders live in `packages/formats` and map conversion in `packages/map-import`. Both run in a
browser too, so they take bytes and never import `node:` modules; the maps stage only walks the data tree,
reads the map files through `readSourceFile` and writes what the package returns. These rules apply
to both packages.

Binary claims need byte-level evidence from the owned copy and synthetic fixtures. Test valid input,
truncation, invalid lengths, and useful round trips. Visual formats also need a human comparison of
locally rendered output with the running original.
A named correction is proven by the pipeline run that applies it; do not test it against a synthetic
file built from its own `from` lines.

A map whose `[StaticObjects]` carries a verb the decoder does not know fails the run: decode the verb,
or add it to the decoder's skipped verbs when the original ignores it too.

Generated bytes and temporary probes stay outside Git. Small synthetic fixtures must be authored for
this repository, not copied from the game.

## Test layout

Tests mirror `src/`: `test/corrections/` for the correction loaders, `test/stages/<stage>/` for a stage
folder (a single-test stage sits at `test/stages/`). Shared builders live in `test/support/`; byte
fixtures come from `packages/formats/test/fixtures/`.

## Required checks

Run normal repository gates, then `npm run test:pipeline` for source parsing, schema, decoder, map, or
output-layout changes. Run `npm run test:content` when runtime joins against generated rows also
changed.

Pipeline usage and environment variables are documented in
[`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md). Format notes live in
[`docs/formats/`](../../docs/formats/).
