# Music: mood variants and attack music

**Area:** audio · **Priority:** P2

A map plays one track for its whole session: `musicType` from the meta sidecar resolved through
`DEFAULT_MUSIC_STEMS` to the Neutral/Standard variant, looping forever. The Friendly/Hostile,
Wealthy/Danger and `Attack_*` renders sit unused in `content/music/`. The seam is ready: the manifest
carries every variant's loop point and `WebAudioEngine.setMusic` crossfades on any track change.

## Scope

- `Theme_*` maps (types 2-5): switch `Friendly`/`Neutral`/`Hostile` with the local player's
  diplomatic state. Blocked on the diplomacy branch landing on `main`.
- `Mission_*` maps: switch `Standard`/`Wealthy`/`Danger`. The original's trigger thresholds live
  only in `the original`; any prosperity/threat heuristic is an approximation and must be named as one.
- `Attack_<tribe>` (types 6-9): play during combat. Establish the selection basis (whose tribe,
  which fight) from evidence before implementing.
- `Theme_Viking_Hostile` alone authors `repeats: 1` where its 63 siblings loop infinitely; decide
  whether to honour that or keep looping it when the hostile variant becomes selectable.
- Put the mood decision in the pure audio director (per-frame, from snapshot state), not in app
  control flow.

## Verify

- Director tests per mood transition (diplomacy flip, mission mood flip, combat start/end).
- Headless check that the expected track file is requested after each transition.
- Human listening pass: transitions crossfade without pops and pick the right variant.
