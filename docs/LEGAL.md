# Legal notice

Open Northland is an independent engine reimplementation licensed under the GNU General Public
License, version 3 or later. The complete license is in [`../LICENSE`](../LICENSE).

## Game data

The repository does not include files from a *Cultures* installation or a generated playable content
set. Users provide their own legally obtained game copy and run the asset pipeline locally. Generated
maps, graphics, rules, fonts, and audio are written under the ignored `content/` directory and must
not be committed or redistributed with the project.

Documentation screenshots may show Open Northland rendering game data decoded locally by the project
maintainer. They demonstrate engine compatibility; they are not a redistributable asset pack, and the
underlying game artwork remains the property of its respective rights holders.

Tests use synthetic fixtures created for this project. A test or pull request must not contain an
original file, decoded asset, extracted text corpus, or other distributable game content.

## Independent implementation

Open Northland is implemented independently from the original engine. Format support is based on
inspection of legally obtained data files, documented byte-level experiments, readable configuration
semantics, standard format specifications, and observation of the running game. Project code must not
be copied or translated from proprietary or third-party engine implementations.

Contributors should record the source basis for new format, mechanic, timing, and visual decisions.
When exact behavior is unknown, the implementation and its tests must identify the approximation.

## Names and trademarks

*Cultures*, *Cultures – 8th Wonder of the World*, *Cultures: Northland*, and related names and logos
belong to their respective owners. They are used here only to identify software compatibility.

Open Northland is a community project. It is not affiliated with, authorized by, sponsored by, or
endorsed by Funatics Software, Daedalic Entertainment, or another rights holder of the *Cultures*
series.
