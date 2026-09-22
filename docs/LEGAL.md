# Legal notice

Open Northland's program code is licensed under the GNU Affero General Public License, version 3 or
later. The complete license is in [`../LICENSE`](../LICENSE). The project's own assets are licensed
separately; see [Project assets](#project-assets).

## Repository

The repository contains no file from a *Cultures* installation and no decoded content. 
`npm run check:assets` enforces that in CI: nothing under
`content/` may be tracked, file types only the original game carries are rejected, and every tracked
image, font, or 3D-model file must be a reviewed project asset. Review covers
what the check cannot see, such as a probe dump or a capture in a text format. Decoded maps,
graphics, rules, fonts, and audio are written under the ignored `content/` directory and never
committed.

Tests use synthetic fixtures created for this project. A test or pull request must not contain an
original file, decoded asset, extracted text corpus, or other distributable game content.

Documentation screenshots and the menu's backdrop stills may show Open Northland rendering decoded
game data. They demonstrate engine compatibility; they are not an asset pack, and the underlying
artwork remains the property of its rights holders.

## Game data and builds

The artwork, sounds, maps, and rules the engine currently plays come from the original game files. 
They remain the property of their rights holders whichever archive carries them.

## Project assets

The project's HUD chrome under `packages/app/src/assets/ui/`, together with the project logo and
icons, is copyrighted and not covered by the AGPL. Their terms are in [`../LICENSE-ASSETS`](../LICENSE-ASSETS): they may be used to
build, run, test and contribute to Open Northland and redistributed unmodified inside a free build of
it. Commercial distribution, use in another product, separate redistribution, and model training need
written permission.

## Independent implementation

Open Northland is implemented independently from the original engine. Format support is based on
inspection of legally obtained data files, documented byte-level experiments, readable configuration
semantics, standard format specifications, and observation of the running game. Project code must not
be copied or translated from proprietary or third-party engine implementations. The evidence policy
is [`SOURCES.md`](SOURCES.md).

Contributors should record the source basis for new format, mechanic, timing, and visual decisions.
When exact behavior is unknown, the implementation and its tests must identify the approximation.

## Names and trademarks

*Cultures*, *Cultures - 8th Wonder of the World*, *Cultures: Northland*, and related names and logos
belong to their respective owners. They are used here only to identify software compatibility.

Open Northland is an independent project. It is not affiliated with, authorized by, sponsored by, or
endorsed by Funatics Software, Daedalic Entertainment, or another rights holder of the *Cultures*
series.
