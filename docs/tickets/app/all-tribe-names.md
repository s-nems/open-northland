# Give every people and creature a stable, appropriate name

**Area:** app, data, sim, pipeline · **Focus:** personal names · **Priority:** P2

Proposed system: independently authored, committed name catalogs for the five civilizations and two
monster peoples; persistent personal identity; one resolver for every player-facing name. Ordinary
animals use species labels. Generated names consist of a given name alone, with no surname,
patronymic, epithet or inheritance. Catalog sizes below are authoring targets, not a completed corpus
or a claim of exact historical practice.

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

Use explicit profile data and one complete given-name entry per person. Parent names and marriage
never affect selection. The same spelling is displayed in every UI language; names need no translated
phrases or grammatical suffixes. Examples illustrate each proposed pool's style, not copied game
records or a claim that the entire eventual pool is historically attested.

| Profile | Male examples | Female examples |
| --- | --- | --- |
| Viking | Erik, Leif, Harald, Ivar, Ulf, Sigurd | Astrid, Sigrid, Ingrid, Gudrun |
| Frank | Chlodwig, Chlothar, Theuderich, Sigebert, Adalbert, Arnulf | Hildegard, Bertrada, Gisela, Radegund |
| Byzantine | Basileios, Niketas, Theodoros, Alexios, Leon, Konstantinos | Theodora, Eirene, Anna, Eudokia |
| Saracen | Yusuf, Hasan, Khalid, Umar, Tariq, Farid | Maryam, Amina, Layla, Zaynab |
| Egyptian | Hori, Nakht, Sennedjem, Amenemhat, Ptahhotep, Khnumhotep | Merit, Iset, Henuttawy, Merytamen |
| Weresnake | Ssarakh, Isshara, Zessir, Sythra, Neshiss, Thassik (shared neutral pool) | Same pool |
| Werewolf | Vargun, Skarn, Urdak, Rauk, Gharok, Vorka (shared neutral pool) | Same pool |

The monster names are newly authored fantasy examples. Ordinary wildlife uses localized species
labels such as `Wąż`, `Wilk`, `Smok`; an explicit scenario name still wins if present. An unknown
person profile uses a localized generic label with a stable distinguishing number (`Nieznajomy 42`),
never the Viking pool, and emits a bounded diagnostic.

Give both monster peoples names regardless of which body/job they currently draw. A weresnake in a
wolf, bear or chicken form retains its identity; its visible form can be a separate role label. A
wild wolf is still wildlife. Route using the tribe's naming profile and animal records/`Person`, never
by the current sprite or an empty technology graph. Reuse the classification work in
[explicit tribe kinds](../sim/model-tribe-kind-explicitly.md) if available; do not make its wider
mechanical changes a prerequisite. Species extraction has its own
[existing ticket](../pipeline/animal-record-names.md); do not duplicate it here.

Target **1,024 male and 512 female given names per civilization**, plus **256 neutral names for
each monster people**: 8,192 catalog entries in total. These sizes support up to 1,024 newly named men
and 512 women of one civilization before their respective pools repeat; they are not a claim of
global uniqueness across different cultures, sexes or authored overrides. Allocation is shared across
player seats within a world so the same faction's enemies do not immediately duplicate its settlers.

These are deliberately large authoring targets. Lists still need independent curation, spelling
review and cultural review. Do not pad them with tiny spelling variants, duplicates, surnames or
unrelated cultures to hit a quota. If an attested corpus cannot support the target, identify the
shortfall explicitly; game-styled inventions must not be presented as historical names. Use one
documented Latin-script spelling policy per culture, Unicode NFC and stable entry keys. Store complete
names rather than generating syllables at runtime. No external name service is needed.

Independent authoring references, not datasets to copy wholesale:

- Norse given-name vocabulary: [National Museum of Denmark](https://en.natmus.dk/historical-knowledge/denmark/prehistoric-period-until-1050-ad/the-viking-age/the-people/names/).
- Medieval European attestations, filtered by place and period rather than taking the whole
  500–1600 range as Frankish: [Dictionary of Medieval Names from European Sources](https://dmnes.org/).
- Byzantine individual-name evidence: [Austrian Academy of Sciences seal project](https://www.oeaw.ac.at/en/byzantine-research/communities-and-landscapes/sigillography/byzantine-seals-in-the-harvard-collections-with-family-names); use given names, not the family-name component.
- Arabic name parts and period examples: [Period Arabic Names and Naming Practices, second edition](https://heraldry.sca.org/names/arabic-naming2.htm).
- Egyptian personal-name evidence: [Persons and Names of the Middle Kingdom](https://zenodo.org/records/8204500).

## Persistent identity and deterministic selection

Introduce a small `NameIdentity` component containing profile key and given-name key. The keys
refer to validated catalog entries, not array positions, display strings or a living relative.
Wildlife needs no component. Unknown profiles use the explicit generic fallback. Keep `GivenName`
and `ScriptedName` as separate display overrides.

Assign identity exactly once at creation, after the final tribe remap and persistent sex are known.
Apply the same operation to map placements, births, scenario helpers, debug spawns, mission spawns
and AI spawns. Heroes can have a generated backing identity, but their authored name takes precedence.
Transfers into sub-missions must carry that identity, not allocate a new one from a new entity id.

Deal names without replacement from a deterministic seed-dependent permutation of each pool, using
a persisted cursor per profile and sex (one shared cursor for a monster pool). A new birth consumes
the next entry regardless of its parents, entity-id gaps or player seat. Persist selected entry keys,
not just the cursor. Allocation must not consume gameplay RNG, depend on locale, or depend on which
UI opened first. Validate integer bounds if using an arithmetic permutation.

When a pool is exhausted, start another deterministic cycle. Repetition is then allowed; do not rename
existing people, add surnames/numbers to ordinary generated names, or introduce an unbounded retry
loop. There is no promise that a newly allocated name after exhaustion differs from every living
person. Explicit player/script names can repeat, and the same name may legitimately occur in more
than one culture. Entity references, portraits, role and owner distinguish those people.

Deaths do not rewind the allocation cursor. Save/load and sub-mission transitions carry the relevant
allocator state; importing an already named person preserves its key without allocating a replacement.
Rebuilds and snapshot reads must not consume names. Saving selected keys ensures list reordering never
reinterprets an existing identity; content compatibility still applies to loading a changed catalog.

Keep identity unchanged through aging, profession/equipment changes, ownership transfer, death of
relatives, marriage, remarriage and monster transformations. Show kinship through existing family
links. There is no naming-specific parent lookup, second-part rule or grammatical-form state.

## Ownership and integration

`packages/data` owns the schemas, independent catalog and profile policies; sim receives them as
validated content and stores the selected keys. Add a name-profile binding to tribe records and a
name-catalog lane to `ContentSet`. The pipeline assembles that lane from the project's catalog, not
from `humannames.ini`; the synthetic fallback uses the same catalog. Keep original-table extraction
out of scope. Profiles cover all five civilization ids and both monster ids explicitly; animal
profiles select species display. Validate cross-references and missing known profiles at load time.

Include identity-affecting catalog keys, ordering and allocation rules in content compatibility.
Localized species/generic labels belong in app i18n and do not influence selection or lockstep.
Bump IR and save versions and regenerate fixtures; reject older formats without migration as
the repository requires. Name-state changes intentionally alter state hashes but must leave gameplay
RNG position and gameplay outcomes unchanged.

Move name resolution to a game-level app module shared by panels, groups, building staff, vehicle
crew, household links, resident search, hover cards and messages. Return a structured result with
`full`, `short` and `source`; never derive a short label with `split(' ')[0]` because personal names
can contain spaces. Keep precedence: resolvable nonempty scenario name → player name → hero name →
generated identity → species/generic label. Missing/empty scenario text falls through. Authored names
remain whole in short form; a generated name has identical full and short forms.

Messages resolve the same identity, including a departed entity's final snapshot for death events.
Keep historical messages' captured names; active entity-linked UI can follow later explicit renames.
Naming requires no recurring whole-world pass or parent traversal; allocation happens only on creation.

Keep the existing rename command's ownership, hero and 24-code-point validation rules. Disable rename
while `ScriptedName` is present so the UI cannot accept an invisible override; use the same guard in
sim, independent of whether this client's map text resolved. Clearing a player name reveals the stored
generated one. Do not add wildlife pet naming in this task. Proper names stay the same when changing
locale; species/generic labels and authored map text follow the existing locale. Long names get layout
truncation and a full tooltip, never silent mutation of the identity. Search must cover full and short labels,
with case/diacritic handling and explicit aliases for letters not reduced by Unicode decomposition.

## Verify

Implement in this order: validated catalog and coverage; deterministic creation/birth identity;
shared resolver and all callers; locale/search/layout checks. Retire the Viking fallback and live
`surnameSourceOf` name dependency. Leave unrelated family, species-extraction and tribe-kind work
with their existing owners. No art or presentation-pack interface change is needed.

- Catalog checks: nonempty pools, stable unique keys, normalized and deduplicated display values
  within each pool, correct tribe bindings, and all selected references resolvable. Common given names
  may also belong to heroes; precedence identifies the hero, not exclusive ownership of a spelling.
  Review cultural spelling and examples separately from automated tests.
- Selection tests: concrete outputs for seven profiles, large consecutive and sparse id populations,
  no repetition within each allocation cycle, deterministic exhaustion, shared allocation across seats,
  legitimate cross-pool/override repeats, seed variation, no use of gameplay RNG, and unknown fallback.
- Lifecycle integration: son and daughter, adulthood, both parents dying, marriage/remarriage,
  profession changes, owner changes, monster form changes, map tribe remap, mission/AI spawns and
  sub-mission transfer. Each identity remains fixed except an explicit override.
- Resolver checks: map/player/hero precedence, missing text, clear rename, multiword given names,
  owned versus enemy units, duplicate names, all HUD callers and death notifications.
- Persistence/network: save/load and replay preserve selected keys and allocation cursors; two peers
  with the same catalog agree, incompatible catalogs are rejected, and changing UI locale does not
  change sim state.
- One focused naming acceptance scene: five civilizations, both monster peoples, a normal snake and
  wolf, a family, a hero, a scripted name and a custom name. Review long labels, search, notifications
  and tooltips in supported locales with a muted browser.
- Run the standard gates plus `test:pipeline`, `test:content` and applicable determinism checks from
  [TESTING.md](../../TESTING.md). This proposal itself requires only documentation checks; it does not
  implement the catalog or change gameplay.
