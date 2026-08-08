# Music: mood variants, attack music, menu theme

**Area:** audio · **Priority:** P2

The first music pass plays one track per map: `musicType` from the meta sidecar resolved through
`DEFAULT_MUSIC_STEMS` to the Neutral/Standard variant, looping forever. The other 36 rendered
variants sit unused in `content/music/`, and the main menu is silent. The seam is ready: the
manifest carries every variant's loop point and `WebAudioEngine.setMusic` crossfades on any track
change.

## Scope

- `Theme_*` maps (types 2-5): switch `Friendly`/`Neutral`/`Hostile` with the local player's
  diplomatic state. Blocked on the diplomacy branch landing on `main`.
- `Mission_*` maps: switch `Standard`/`Wealthy`/`Danger`. The original's trigger thresholds live
  only in `the original`; any prosperity/threat heuristic is an approximation and must be named as one.
- `Attack_<tribe>` (types 6-9): play during combat. Establish the selection basis (whose tribe,
  which fight) from evidence before implementing.
- `Theme_Viking_Hostile` alone authors `repeats: 1` where its 63 siblings loop infinitely; decide
  whether to honour that or keep looping it when the hostile variant becomes selectable.
- Main menu: hypothesis from the research notes reversing repo (not admissible evidence) is that the
  menu plays type 2 (`Theme_Viking_*`); confirm by observing the original before implementing.
  Needs a music-capable driver in the menu entry, which today has no audio at all.
- Put the mood decision in the pure audio director (per-frame, from snapshot state), not in app
  control flow.

## Verify

- Director tests per mood transition (diplomacy flip, mission mood flip, combat start/end).
- Headless check that the expected track file is requested after each transition.
- Human listening pass: transitions crossfade without pops and pick the right variant.
