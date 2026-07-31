# Source policy

Open Northland reads a legally obtained *Cultures – 8th Wonder of the World* installation and writes
decoded content to the local, ignored `content/` directory. Original files, decoded assets, and
generated content are not part of the repository.

The project is an independent implementation. Format and behavior work is based on:

1. readable configuration files shipped with the game or installed mod;
2. byte-level inspection of legally obtained data files;
3. synthetic round-trip fixtures written for this repository;
4. observation of the running original game; and
5. published specifications for standard formats such as PCX and Windows cursor files.

Do not copy or translate code from another engine implementation. Do not paste original data into a
test fixture. Record enough evidence for another contributor to reproduce a format or behavior
decision from the allowed sources above.

The project-wide legal and trademark notice is in [`LEGAL.md`](LEGAL.md).

## Source precedence

Prefer the most direct readable source available:

1. the CulturesNation mod's readable `.ini` override;
2. a base-game plaintext `.ini` file;
3. a decoded `.cif` table when no readable twin exists; and
4. observation of the running game for behavior not represented in data.

Source keys are case-sensitive, repeated keys and list-valued keys have different shapes, and numeric
ids are often scoped by record family or tribe. Verify the real key space before adding an index or
cross-reference.

When one path exists in more than one place, the layers resolve mod overlay, then base install, then
`.lib` member: a loose file wins its archive twin. 75 paths collide that way in the owned copy (66
`.pcx`, 4 `.bmd`, 3 `.fnt`, 2 `.bmp`). The basis is data consistency rather than a direct observation
of the original: the mod's `mapmoveableanimations/animations.ini` indexes 312 bobs of
`CR_Hum_Body_74.bmd`, which only the loose copy carries, while the archive copy has the base game's 96
— matching the base `animations.cif`, whose one sequence indexes 96. A mod-installed tree is
self-consistent only under loose-first.

Only the stages that read both places carry the archive layer (the `.pcx` conversion, the atlas source
index, the transition-overlay compose). The rest read loose files exclusively, which resolves the same
way for every collision above; an archive-**only** file of those kinds would stay invisible to them.

## Supported input formats

| Format | Purpose | Project reference |
| --- | --- | --- |
| `.ini` | readable rules and graphics bindings | [`DATA-FORMAT.md`](DATA-FORMAT.md) |
| `.cif` | compiled string tables, type tables, map logic, UI strings | [`formats/CIF.md`](formats/CIF.md) |
| `map.dat` | terrain, map dictionaries, and placed landscape objects | [`formats/MAPDAT.md`](formats/MAPDAT.md) |
| `.bmd` | palette-indexed sprite frames and animations | [`formats/GRAPHICS.md`](formats/GRAPHICS.md) |
| `.pcx` | palette-indexed pictures and palette carriers | [`formats/GRAPHICS.md`](formats/GRAPHICS.md) |
| `.fnt` | bitmap-font wrapper around a bob container | [`formats/GRAPHICS.md`](formats/GRAPHICS.md) |
| `.lib` | packed file library | decoder tests and `decoders/lib.ts` |
| `.cur` | Windows cursor resource | decoder tests and `decoders/cur.ts` |
| `.wav` | sound effects and voices | browser-native playback |
| `.sgt` / `.dls` | DirectMusic soundtrack data | not yet supported |

## Verification

Every binary decoder needs synthetic fixtures that cover valid data, malformed boundaries, and a
round trip where an encoder is useful. Real pipeline runs verify that the decoded structure matches
the owned input corpus, but generated output remains outside Git.

Visual formats require two checks:

- structural checks in tests, such as dimensions, frame counts, palette indices, and atlas bounds;
- human comparison between Open Northland and the running original at a known map position.

Mechanic tests prove deterministic behavior and internal consistency. They do not prove fidelity.
When readable data or direct observation does not determine a mechanic, mark the implementation as an
approximation and state what remains unknown.

## Data that remains local

The following must stay outside the repository:

- the game installation and mod files;
- decoded `content/` output;
- reference captures from the original game;
- temporary decoder dumps and binary probes; and
- transcoded audio or extracted text tables.

Documentation may record compact format facts, measurements, and short identifiers needed for
interoperability. It should not become a dump of the original data or a chronological research log.
