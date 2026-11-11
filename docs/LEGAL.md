# Legal notice

Open Northland's program code and project assets are licensed under the GNU Affero
General Public License, version 3 or later. The complete license is in [`../LICENSE`](../LICENSE).

## Repository

The repository contains no file from a *Cultures* installation and no decoded content.
`npm run check:assets` enforces that in CI: nothing under
`content/` may be tracked, file types only the original game carries are rejected, and every tracked
image, font, or 3D-model file must be a reviewed project asset. Review covers
what the check cannot see, such as a probe dump or a capture in a text format. Decoded maps,
graphics, rules, and audio are written under the ignored `content/` directory and never
committed. The one exception is a pipeline correction: it quotes the few lines it replaces in one
source file, so the pipeline can check that they still match. Most are script command lines, briefing
block markers and display strings. Original text takes no source-language overlay (see below), so a
correction of a campaign or tutorial briefing or goal still quotes the few lines of original prose it
fixes, before and after the fix.

The app bundles third-party typefaces in `packages/app/public/fonts/`: Alegreya Sans, Alegreya Sans SC,
Cinzel and Noto Sans SC, under the SIL Open Font License 1.1. Their licence texts sit beside them as
`LICENSE-*.txt`.

The multiplayer menu shows each player's chosen flag from the `flag-icons` npm package, Copyright (c)
2013 Panayiotis Lipiridis, under the MIT license; its notice is in
`packages/app/public/licenses/THIRD-PARTY-NOTICES.txt`.

A siege attack plays "Colossal Boss Battle Theme" ("Blackmoor Colossus") by Matthew Pablo
(http://www.matthewpablo.com/services), under Creative Commons Attribution 3.0
(https://creativecommons.org/licenses/by/3.0/), from https://opengameart.org/node/20947. The app
ships it as `packages/app/public/audio/colossal-boss-battle.ogg`, converted from the author's MP3 to
Ogg Vorbis and lowered by 3 dB; its notice is in `packages/app/public/licenses/THIRD-PARTY-NOTICES.txt`.

The Byzantine long-sword soldier's blow plays "bing1.wav" from "Metal Impact Sounds" by BMacZero, under
Creative Commons CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/), from
https://opengameart.org/node/118334. The app ships it as `packages/app/public/audio/mace-hit.ogg`,
trimmed of its 30 ms lead-in, lowered by 13 dB and encoded as Ogg Opus; its notice is in the same file.

Text imported from game or mod tables is also generated content, including UI labels. Keep table/id
bindings in code and load the wording through the pipeline. Project-authored UI text, intentional
label overrides and independently written fallbacks may stay in the repository; a fallback must not
serve as a committed copy of the imported text table. Ordinary shared vocabulary is not excluded.

Third-party translations: fan translations are imported as JSON overlays under `translations/`, with
each set's license and provenance recorded in [`translations/SOURCES.md`](../translations/SOURCES.md).
An imported or project-written translation holds only the translated text keyed by string id or block
label. An overlay in a source language is the project's edit of a community map's text: the edited
ids and blocks in the project's wording, never a campaign map's or an original tutorial's text, which
stay pipeline corrections. The one exception is the glossary, `translations/glossary.csv` and
`translations/glossary-project.csv`: beside each Chinese term it keeps the German, English and Polish
term it translates (names of characters, places, objects and maps).

Independently authored film subtitles under `translations/<lang>/campaigns/<campaign>/films/`
are also permitted: transcriptions of the narration and their translations, with provenance in
`translations/SOURCES.md`. This exception covers subtitle text, not the recordings or video files.

Tests use synthetic fixtures created for this project. A test or pull request must not contain an
original file, decoded asset, extracted text corpus, or other distributable game content.

Documentation screenshots, including the README's, and the menu's backdrop stills under
`packages/app/src/assets/menu-backdrops/`, which the loading screen also shows, may show Open
Northland rendering decoded game data. They demonstrate engine compatibility; they are not an asset
pack, and the underlying artwork remains the property of its rights holders.

## Game data and builds

The artwork, sounds, maps, and rules the engine currently plays come from the original game files.
They remain the property of their rights holders whichever archive carries them.

Open Northland assumes that you own the original game: an installed copy of any of *Cultures 2:
The Gates of Asgard*, *Cultures: Northland* or *Cultures - 8th Wonder of the World*, from disc,
Steam, GOG or the Mac App Store. The game checks for one before it first starts. Using Open
Northland without owning the original is your responsibility, not the project's; the project
accepts no liability for it.

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

## Third-party code

The art filter's prescaled scalers port GPU shaders from the libretro shader collection
(<https://github.com/libretro/glsl-shaders>). Each ported file keeps its original copyright and
license notice and says what was changed; the notice also opens the shader source it builds, so every
copy of the program carries it. `packages/app/public/licenses/` ships with the web and desktop builds
as `licenses/`: `THIRD-PARTY-NOTICES.txt` lists the ports with their notices and `GPL-3.0.txt` holds
the GPL text, and the credits screen links the notices beside the AGPL license.

- `packages/render/src/gpu/pixel-art/xbrz-2x.ts`, from `xbrz/shaders/xbrz-freescale.glsl`: Hyllian's
  xBR texel mapping, Copyright (C) 2011/2016 Hyllian, MIT license; the xBRZ rules, Copyright (C)
  Zenju, GNU General Public License version 3. The file stays under GPL-3.0. Section 13 of the GPL-3.0
  permits combining it with this AGPL-3.0 work: the combination is conveyed with the project's code
  under the AGPL-3.0 and this file under the GPL-3.0, and the AGPL's network clause (its section 13)
  applies to the combination as a whole. Distributing Open Northland under any other license, a later AGPL version included,
  requires removing or replacing this file. The file's linking exception names MAME only and gives
  this project nothing. Its modification notice carries a date, as GPL-3.0 section 5(a) asks.
- `packages/render/src/gpu/pixel-art/super-xbr-2x.ts`, from
  `xbr/shaders/super-xbr/super-xbr-pass{0,1,2}.glsl`: Copyright (c) 2015 Hyllian, MIT license.
- `packages/render/src/gpu/pixel-art/mmpx-2x.ts`, from `scalenx/shaders/mmpx.glsl`: Copyright 2020
  Morgan McGuire and Mara Gagiu, MIT license.

The root and desktop `package.json` therefore declare `AGPL-3.0-or-later AND GPL-3.0-only`: the
project's own code stays under the AGPL version 3 or later, and the xBRZ file under the GPL version 3.

## Names and trademarks

*Cultures*, *Cultures - 8th Wonder of the World*, *Cultures: Northland*, and related names and logos
belong to their respective owners. They are used here only to identify software compatibility.

Open Northland is an independent project. It is not affiliated with, authorized by, sponsored by, or
endorsed by Funatics Software, Daedalic Entertainment, or another rights holder of the *Cultures*
series.
