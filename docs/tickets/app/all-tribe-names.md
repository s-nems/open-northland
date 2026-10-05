# Give every people and creature a stable, appropriate name

**Area:** app, data, sim, pipeline · **Focus:** personal names · **Priority:** P2

Proposed system: independently authored, committed name catalogs for the five civilizations and two
monster peoples; persistent personal identity; one resolver for every player-facing name. Ordinary
animals use species labels. The catalogs and family rules below are a design proposal, not original
game content or a claim of exact historical practice.

## Verified problem

`packages/app/src/game/character-names/pools.ts` defines only Vikings: 101 male and 72 female given
names. Every other tribe, including unknown ids, falls back to that pool. A coprime permutation of the
entity id selects a given name and an unrelated male-name root; `characterName` appends `sson` or
`sdóttir`. The independent grids contain 10,201 male and 7,272 female combinations. There is no world
seed, allocation or saved generated identity. The same id therefore produces the same name across
games with the same inputs. Distinct residues in a grid give distinct pairs; arbitrary sparse entity
ids and inherited second names do not have that uniqueness guarantee.

`Female` overrides the fallback job-based sex inference. The HUD's current precedence is map
`ScriptedName` → player `GivenName` → conventional hero name → generated name. Short labels preserve
authored/hero names whole and otherwise show only the generated given name.

Two connected defects belong in this change:

- `surnameSourceOf` in `game/snapshot-family.ts` uses the husband for a wife and the father only while
  a child is young. An adult loses that surname; a child's lookup also depends on surviving parent
  records. It copies the man's second name, not his actual given name, and gives daughters the male
  ending. For ids father=12, child=55, the current helper yields `Solmund Skardesson` while young and
  `Solmund Vesteinsson` as an adult; the father is `Yngvi Skardesson`.
- `hud/tool-panel/messages/index.ts` calls `characterName` directly, bypassing the map, player and
  hero overrides used by `hud/details-panel/model/settler-name.ts`.

The claim in the existing pool comment that the original carries none of these names is incorrect:
the owned name table contains overlapping given names. Replace that claim with the actual provenance
of the independently curated replacement catalog.

## Original data and confidence

The owned `Data/text/pol/strings/gameobjects/humannames.ini` contains repeated `[names]` sections,
`logictribe <id>` and `Name 0/1 "text"` rows. The same relative file in the pinned mod is byte-identical.
The owned English, German and Russian `humannames.cif` files were decoded with the existing CIF
decoder; their per-tribe counts match the Polish table, and each matches its mod counterpart byte for
byte. These installed language files need not represent different translations.

| Tribe | Id | Male rows (distinct strings) | Female rows (distinct strings) |
| --- | --- | --- | --- |
| Vikings | 1 | 170 (163) | 68 (66) |
| Franks | 2 | 252 (252) | 59 (59) |
| Byzantines | 3 | 329 (329) | 139 (139) |
| Saracens | 4 | 85 (81) | 138 (137) |
| Egyptians | 7 | 10 (10) | 8 (8) |
| Weresnakes | 5 | 5 (5) | 1 placeholder |
| Werewolves | 6 | 5 (5) | 1 placeholder |

The table contains complete name strings, no separate surname list or name-part assembly rules.
The two female monster entries are unnamed-female placeholders, not additional personal names.
There are no sections for ordinary animal tribes. `tribetypes`, `animaltypes` and the current IR
distinguish weresnakes (5) from ordinary snakes (40), and include dragons (41) among animals. The IR
has no personal-name pool lane; the original table is currently unused by our generator.

Original behavior, provisional and unconfirmed against the running original: select a complete name
by tribe and sex when creating a character, using a random table entry; missing pools yield an unnamed
fallback. Study suggests the name is retained separately from a change of body/job. Exact random
sequence, duplicate handling, naming through marriage/birth and save persistence still require live
observation. The data confirms the pool layout and counts, not those runtime details. In particular,
our generated surnames and current household surname rule are not established original behavior.

Do not distribute these tables or use the owned installation as pipeline input. Their role here is
evidence. Curate our lists independently under [the legal contract](../../LEGAL.md).

## Scope

### Catalog and visible naming rules

Use explicit profile data, not one universal suffix or branches on tribe ids in systems. A second
member of a name can be a patronymic, a family name or a personal epithet; do not call all three a
hereditary surname. Examples below illustrate proposed output, not names copied as records from the
game. Historical inspiration is deliberately simplified for the game's mixed setting.

| Profile | Composition | Example output | Family rule |
| --- | --- | --- | --- |
| Viking | Norse given name + curated patronymic form | `Leif Eriksson`, `Astrid Eriksdóttir` | Child uses father's given-name key, with its own sex's form; adults keep their names on marriage. |
| Frank | Frankish/medieval given name + family byname | `Adalbert Steinbach`, `Adelheid Steinbach` | Child inherits father's family key; spouses retain their birth names. Treat hereditary bynames as a gameplay convention. |
| Byzantine | Greek/Byzantine given name + family form | `Niketas Doukas`, `Anna Doukaina` | Child inherits family key; catalog supplies masculine/feminine forms; spouses retain their birth names. |
| Saracen | Arabic given name + `ibn`/`bint` + father's given name | `Yusuf ibn Hasan`, `Maryam bint Hasan` | Child uses father's given-name key; marriage does not replace it. This profile is a deliberate bounded interpretation of the game's broad label. |
| Egyptian | Ancient Egyptian given name + individual byname | `Hori z Teb`, `Merit znad Nilu` | Byname belongs to the individual, not the household. Ancient-themed, not a second copy of the Saracen pool. |
| Weresnake | Authored fantasy name + epithet | `Ssarakh Miedziana Łuska` | Shared neutral given-name pool; no fabricated human genealogy. |
| Werewolf | Authored fantasy name + epithet | `Vargun Szary Kieł` | Shared neutral given-name pool; no fabricated human genealogy. |
| Wildlife | Localized species label | `Wąż`, `Wilk`, `Smok` | No random human name or surname; explicit scenario name still wins if present. |
| Unknown person | Localized generic person label + stable distinguishing number | `Nieznajomy 42` | No Viking fallback; emit a bounded diagnostic for the missing profile. |

Give both monster peoples names regardless of which body/job they currently draw. A weresnake in a
wolf, bear or chicken form retains its identity; its visible form can be a separate role label. A
wild wolf is still wildlife. Route using the tribe's naming profile and animal records/`Person`, never
by the current sprite or an empty technology graph. Reuse the classification work in
[explicit tribe kinds](../sim/model-tribe-kind-explicitly.md) if available; do not make its wider
mechanical changes a prerequisite. Species extraction has its own
[existing ticket](../pipeline/animal-record-names.md); do not duplicate it here.

Target independently curated pools of **384 male and 192 female given names per civilization**.
That exceeds every corresponding inspected original pool. Provide 128 second-name keys each for
Franks, Byzantines and Egyptians; Vikings and Saracens use the 384 male given-name keys as potential
parent names. Give each monster profile 128 neutral given names and 64 epithets. These are authoring
targets, not a claim that a reviewed corpus already exists. Do not pad lists with duplicate spellings
or present invented names as historically attested just to meet a count.

That yields 49,152 male / 24,576 female combinations for each 128-key profile, 147,456 / 73,728 for
each 384-key patronymic profile, and 8,192 per monster people. These are capacities, not guarantees
that random selection or inherited family names cannot collide.

Store complete, reviewed name parts. In particular, store Norse patronymic forms and Byzantine
family variants explicitly instead of guessing inflection by appending letters. Egyptian and monster
epithets are complete localized phrases, including any required gender forms. Use one documented
Latin-script spelling policy per culture, Unicode NFC, stable entry keys and no runtime syllable
generator or external name service.

Independent authoring references, not datasets to copy wholesale:

- Norse given-name and byname vocabulary: [National Museum of Denmark](https://en.natmus.dk/historical-knowledge/denmark/prehistoric-period-until-1050-ad/the-viking-age/the-people/names/).
- Medieval European attestations, filtered by place and period rather than taking the whole
  500–1600 range as Frankish: [Dictionary of Medieval Names from European Sources](https://dmnes.org/).
- Byzantine family-name evidence: [Austrian Academy of Sciences seal project](https://www.oeaw.ac.at/en/byzantine-research/communities-and-landscapes/sigillography/byzantine-seals-in-the-harvard-collections-with-family-names).
- Arabic name parts and period examples: [Period Arabic Names and Naming Practices, second edition](https://heraldry.sca.org/names/arabic-naming2.htm).
- Egyptian personal-name evidence: [Persons and Names of the Middle Kingdom](https://zenodo.org/records/8204500).

## Persistent identity and deterministic selection

Introduce a small `NameIdentity` component containing profile key, given-name key, second-part key
and the chosen grammatical form. The keys refer to validated catalog entries, not array positions,
display strings or a pointer to a living relative. Wildlife needs no component. Unknown profiles use
the explicit generic fallback. Keep `GivenName` and `ScriptedName` as separate display overrides.

Assign identity exactly once at creation, after the final tribe remap and persistent sex are known.
Apply the same operation to map placements, births, scenario helpers, debug spawns, mission spawns
and AI spawns. Heroes can have a generated backing identity, but their authored name takes precedence.
Transfers into sub-missions must carry that identity, not allocate a new one from a new entity id.

Select the default pair with an integer permutation of the name grid, salted by simulation seed and
profile. This is a deterministic mapping, not a draw from gameplay RNG. Validate arithmetic bounds;
do not use the current floating-point golden-ratio calculation in sim. Save the selected keys so
reordering lists cannot rename existing people. Equal inputs on every peer yield equal keys; neither
locale nor UI access order participates. Catalog growth may affect newly selected names but must not
reinterpret a saved key.

At birth, replace the default second-part key according to the profile's data-defined inheritance
rule: father's given key for patronymics, father's family key for family names, or keep the independent
byname. Select the child's appropriate form, not the father's rendered suffix. When a parent lacks a
compatible identity, retain the child's deterministic default. Current marriages are same-tribe;
cross-culture marriages are outside this change. Player/script name overrides are opaque full labels:
do not split them to manufacture a child's patronymic or retrospectively rename relatives.

Keep identity unchanged through aging, profession/equipment changes, ownership transfer, death of
relatives, marriage, remarriage and monster transformations. This deliberately replaces the current
wife-takes-husband-name behavior. Show kinship through the existing family links, not by forcing every
culture into one household surname.

Allow repeated full names. Grid selection spreads unrelated entities until residues repeat, while
inheritance narrows the available combinations. Do not add global scans, unbounded retry loops,
automatic renaming of existing people or a promise of global uniqueness. Entity references remain
the actual identity; portraits, role and owner distinguish people in lists. Explicit user names can
repeat too. A uniqueness allocator is outside the proposed scope.

## Ownership and integration

`packages/data` owns the schemas, independent catalog and profile policies; sim receives them as
validated content and stores the selected keys. Add a name-profile binding to tribe records and a
name-catalog lane to `ContentSet`. The pipeline assembles that lane from the project's catalog, not
from `humannames.ini`; the synthetic fallback uses the same catalog. Keep original-table extraction
out of scope. Profiles cover all five civilization ids and both monster ids explicitly; animal
profiles select species display. Validate cross-references and missing known profiles at load time.

Include identity-affecting catalog keys, ordering and policies in content compatibility. Localized
epithet/species labels belong in app i18n and do not influence selection or lockstep. Bump IR and save
versions and regenerate fixtures in the implementation; reject older formats without migration as
the repository requires. Name-state changes intentionally alter state hashes but must leave gameplay
RNG position and gameplay outcomes unchanged.

Move name resolution to a game-level app module shared by panels, groups, building staff, vehicle
crew, household links, resident search, hover cards and messages. Return a structured result with
`full`, `short` and `source`; never derive a short label with `split(' ')[0]` because personal names
can contain spaces. Keep precedence: resolvable nonempty scenario name → player name → hero name →
generated identity → species/generic label. Missing/empty scenario text falls through. Authored names
remain whole in short form; ordinary generated short form is the complete given-name entry.

Messages resolve the same identity, including a departed entity's final snapshot for death events.
Keep historical messages' captured names; active entity-linked UI can follow later explicit renames.
Names, second parts and kinship require no recurring whole-world pass or parent traversal.

Keep the existing rename command's ownership, hero and 24-code-point validation rules. Disable rename
while `ScriptedName` is present so the UI cannot accept an invisible override; use the same guard in
sim, independent of whether this client's map text resolved. Clearing a player name reveals the stored
generated one.
Do not add wildlife pet naming in this task. Proper names stay the same when changing locale;
epithets, species and authored map text follow the existing locale. Long names get layout truncation
and a full tooltip, never silent mutation of the identity. Search must cover full and short labels,
with case/diacritic handling and explicit aliases for letters not reduced by Unicode decomposition.

## Verify

Implement in this order: validated catalog and coverage; deterministic creation/birth identity;
shared resolver and all callers; locale/search/layout checks. Retire the Viking fallback and live
`surnameSourceOf` name dependency. Leave unrelated family, species-extraction and tribe-kind work
with their existing owners. No art or presentation-pack interface change is needed.

- Catalog checks: nonempty pools, stable unique keys, normalized and deduplicated display values,
  complete grammatical forms/locales, correct tribe bindings, no reserved hero full names, and all
  selected references resolvable. Review cultural spelling and examples separately from automated tests.
- Selection tests: concrete outputs for seven profiles, large consecutive and sparse id populations,
  legitimate repeated names, seed variation, no use of gameplay RNG, and unknown profile fallback.
- Lifecycle integration: son and daughter, adulthood, both parents dying, marriage/remarriage,
  profession changes, owner changes, monster form changes, map tribe remap, mission/AI spawns and
  sub-mission transfer. Each identity remains fixed except an explicit override.
- Resolver checks: map/player/hero precedence, missing text, clear rename, multiword given names,
  owned versus enemy units, duplicate names, all HUD callers and death notifications.
- Persistence/network: save/load and replay preserve selected keys; two peers with the same catalog
  agree, incompatible catalogs are rejected, and changing UI locale does not change sim state.
- One focused naming acceptance scene: five civilizations, both monster peoples, a normal snake and
  wolf, a family, a hero, a scripted name and a custom name. Review long labels, search, notifications
  and tooltips in supported locales with a muted browser.
- Run the standard gates plus `test:pipeline`, `test:content` and applicable determinism checks from
  [TESTING.md](../../TESTING.md). This proposal itself requires only documentation checks; it does not
  implement the catalog or change gameplay.
