# Content Packs

The main menu's **Mods** screen installs ZIP archives into browser storage. A pack is data-only: the
app never executes files from an archive. Installed files are read through the regular content paths,
so the pack can replace generated rules, graphics, sounds, maps, or text without changing the app build.

## ZIP Layout

Include an `ir.json` patch, plus any files the pack overrides. Files can be at the archive root or
inside a single content folder; the archive may also contain one enclosing folder. The content root
is the directory containing `ir.json`:

```text
my-pack.zip
  content/
    ir.json
    bobs/
      atlases.json
      custom-atlas.webp
    maps/
      maps-index.json
```

`ir.json` may contain only the lanes and rows it changes; each supplied row is checked against the
same strict schema as generated game content. Rows with the same stable identity override matching
fields, new rows are added, and the assembled `ContentSet` is checked for cross-references before it
loads. A complete generated `ContentSet` is also accepted. A partial patch requires the game's base
`content/ir.json`. The pack's displayed name comes from the ZIP filename. Additional files are overlaid
at their paths relative to the content root; unknown files are inert and are never executed.

If multiple enabled packs contain the same path, the pack with the lexicographically greater SHA-256
archive ID wins. This makes the result independent of install order. The lobby identity includes the
IDs of all enabled archives, so peers with different pack sets are rejected before the game starts.

Import limits are 64 MiB per archive, 128 MiB unpacked per pack, 16 MiB per file, and 5,000 entries.
ZIP64, encrypted entries, invalid paths, and packs that exceed the 512 MiB installed-storage budget
are rejected. Installing, enabling, or removing a pack stores the change at once, and the menu reloads
only when the player leaves the Mods screen, so one visit can change several packs. The reload keeps
cached content from leaking into a game using the new selection.

## New civilizations

A pack can add a whole people beside the original five. The `tribes` lane carries the rules, and a
`civilization: true` flag on that row is what the app reads: the lobby's civilization pickers list the
people, a seat may switch to it, its art loads on the maps that field it, and the HUD names it from
the row's `name`. The authored five carry no flag - they are the floor every build offers.

The `typeId` must be one the rest of the content does not use. The original's ids above the monsters
(5, 6) name animal species, which the wildlife join owns, so a people takes a free id above them
(42 is the first after the shipped content); a flagged row on an animal species is rejected at load.

Two packs may add a people under the same identity. The pack that merges later - the one whose
archive id sorts greater, the same tie-breaker the file overlay uses, so the outcome stays
independent of install order - then re-keys its people instead of overwriting or failing: its
`civilization` row takes the first free `chinese-2`-style slug and, when its `typeId` is taken too,
the first id above every `tribes`, `animals` and `weapons` row. Every tribe-bound row of that pack
follows the move - `weapons`, `personalNames`, the house-art lanes, the `sounds` voice tables,
`humanPalettes.jobChanges`, the `buildings` variants and the row's own `unitVariants` weapon refs,
plus row ids the pack derived from its slug (`chinese-male`, `chinese_fist`). The fallback keys on
the data, not on the flag alone: it also fires when the pack's rows kept an authored tribe id their
edited tribe row no longer names - a slug-derived row id still ties them to the people - and when a
pack brings a name pool onto a `(tribe, sex)` pair another pool already holds, which catches a
flagless row too, since pools cannot override through a different id. Rows without the flag that
bring no such clash keep the override semantics: they patch the identity they name, and a row -
flagged or not - naming an identity the base itself carries is that base people coming back and
overrides in place. Map scripts spawn tribes by absolute
id and are not rewritten.

A playable people needs more than its rules row, because the settlers draw and arm per tribe while
the buildings draw per `(tribe, typeId)`:

- `weapons`: the class weapons are keyed `(tribeType, typeId)`; without own rows the people's soldiers
  stand unarmed. Clone an existing civilization's rows onto the new tribe, renaming each `id` (the
  rows join by `id` and `typeId`, so a verbatim clone would overwrite the source tribe's row).
- `personalNames`: one pool per sex. Without one the people's settlers go unnamed.
- `buildingBobs`, `constructionLayers`, `buildingOverlays`, `buildingFlagPoints`,
  `buildingSoldierFlagPoints`, `buildingHolyFirePoints`: the house art is keyed `(tribeId, typeId)`.
  Cloning another tribe's rows onto the new `tribeId` makes the people build in that tribe's style;
  without them its houses fall back to the base tribe's look.
- `buildings` (optional): where the cloned buildings stand on the source tribe's own footprint or
  carry its own hitpoints, add the same `tribeVariants` entries for the new tribe.

What the pack may leave out: `[jobbasegraphics]` rows and the atomic/gait tables - a tribe that
authors none keeps the base tribe's character table, so a people meant to look like another
civilization's settlers needs no graphics rows of its own. Vehicles likewise fall back to the base
tribe. `tools/mods/build-people-mod.mjs` assembles all of the above from the installed `content/`:

```sh
node tools/mods/build-people-mod.mjs --from viking --buildings frank --id northmen --name Northmen
```

The command writes `northmen.zip`, ready to import on the Mods screen. The people then plays on any
map: pick it on a seat in the lobby, and the map's viking houses and settlers take the new people -
its own settlers' look (here the vikings') and the buildings' drawn style (here the franks').