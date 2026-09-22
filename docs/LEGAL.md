# Legal notice

Open Northland's program code and [project assets](#project-assets) are licensed under the GNU Affero
General Public License, version 3 or later. The complete license is in [`../LICENSE`](../LICENSE).

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

The project's HUD chrome under `packages/app/src/assets/ui/`, the project logo and the icons are
licensed under AGPL-3.0-or-later with the code. The HUD chrome was generated for this project with
image models from text prompts, without original-game input.

## Independent implementation

Open Northland is implemented independently from the original engine. Format support is based on
inspection of legally obtained data files, documented byte-level experiments, readable configuration
semantics, standard format specifications, and observation of the running game. Project code must not
be copied or translated from proprietary or third-party engine implementations.

Where data files and observation leave a behavior open, the project may study the original game to the
extent needed for interoperability, as applicable law permits. Such study only establishes facts about
the original's behavior. Its code is never copied, translated, or reproduced in structure, and the
results are documented as original behavior.

Contributors should record the source basis for new format, mechanic, timing, and visual decisions.
When exact behavior is unknown, the implementation and its tests must identify the approximation.

## Names and trademarks

*Cultures*, *Cultures - 8th Wonder of the World*, *Cultures: Northland*, and related names and logos
belong to their respective owners. They are used here only to identify software compatibility.

Open Northland is an independent project. It is not affiliated with, authorized by, sponsored by, or
endorsed by Funatics Software, Daedalic Entertainment, or another rights holder of the *Cultures*
series.
