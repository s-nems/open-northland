# Source policy

Open Northland reads the unpacked CulturesNation mod archive and writes decoded content to the local,
ignored `content/` directory. A legally obtained *Cultures – 8th Wonder of the World* installation
serves as byte-level evidence for format and behavior research, not as a pipeline input. Original
files, mod files, decoded assets, and generated content are not part of the repository.

The project is an independent implementation. Format and behavior work is based on:

1. readable configuration files shipped with the game or installed mod;
2. byte-level inspection of legally obtained data files;
3. synthetic round-trip fixtures written for this repository;
4. observation of the running original game; and
5. published specifications for standard formats such as PCX and Windows cursor files.

Do not copy or translate code from another engine implementation. Do not paste original data into a
test fixture. Record enough evidence for another contributor to reproduce a format or behavior
decision from the allowed sources above.

Third-party reverse-engineering notes and code may suggest a probe, but they are not implementation
evidence. Re-check the claim against the owned files, readable configuration, or the running original.
Credit a lead that shaped the probe; do not translate its implementation.

The project-wide legal and trademark notice is in [`LEGAL.md`](LEGAL.md).

## Evidence baseline

Corpus counts in the current documentation use an English-locale conversion of CnMod 1.3.2. State a
different input beside any claim that uses one. When the baseline changes, re-run the affected counts
instead of carrying the old numbers forward.

## Source precedence

Prefer the most direct readable source available:

1. the CulturesNation mod's readable `.ini` override;
2. a base-game plaintext `.ini` file;
3. a decoded `.cif` table when no readable twin exists; and
4. observation of the running game for behavior not represented in data.

Source keys are case-sensitive, repeated keys and list-valued keys have different shapes, and numeric
ids are often scoped by record family or tribe. Verify the real key space before adding an index or
cross-reference.

The mod archive ships every file the stages read: the rule tables (readable `.ini` where the base
has only `.cif`), every `.bmd`, the sounds, the `DataX/DM2` soundtrack, the pictures, fonts, string
tables, and the mod's maps. The original game's packed `data0001.lib` adds nothing the stages
consume: a conversion of the mod alone and one of the mod plus an owned installation produce
byte-identical rules, atlases, interface art, fonts, transitions, and music, and the archive's
`Data/maps` campaigns are not decoded by any stage. Basis: the `CnMod 1.3.2.zip` central directory
(43,310 entries) compared against the served content tree, and a directory diff of the two
conversions over the owned copy.

## Supported input formats

| Format | Purpose | Project reference |
| --- | --- | --- |
| `.ini` | readable rules and graphics bindings | [`DATA-FORMAT.md`](DATA-FORMAT.md) |
| `.cif` | compiled string tables, type tables, map logic, UI strings | [`formats/CIF.md`](formats/CIF.md) |
| `map.dat` | terrain, map dictionaries, and placed landscape objects | [`formats/MAPDAT.md`](formats/MAPDAT.md) |
| `.bmd` | palette-indexed sprite frames and animations | [`formats/GRAPHICS.md`](formats/GRAPHICS.md) |
| `.pcx` | palette-indexed pictures and palette carriers | [`formats/GRAPHICS.md`](formats/GRAPHICS.md) |
| `.fnt` | bitmap-font wrapper around a bob container | [`formats/GRAPHICS.md`](formats/GRAPHICS.md) |
| `.cur` | Windows cursor resource | decoder tests and `decoders/cur.ts` |
| `.wav` | sound effects and voices | browser-native playback |
| `.sgt` / `.dls` | DirectMusic soundtrack data | decoded by `decoders/sgt.ts`, `decoders/sgt-tracks.ts`, `decoders/dls.ts`; performed by `stages/music/interpret.ts`, a behavioral port of the MIT [libdmusic](https://github.com/frabert/libdmusic) player with music-value resolution as documented from binary analysis by the MIT [GothicKit dmusic](https://github.com/GothicKit/dmusic) project, proven by event parity against the previously vendored renderer over the owned corpus. Tracks publish at the 44.1 kHz synth rate rather than the audiopath's requested 22050 Hz port rate: most bank samples are 44.1 kHz, and a recording of the original carries content past 11 kHz with no break there |

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
