# Music: mood variants, attack music, menu theme

The first music pass plays one track per map: `musicType` from the meta sidecar resolved through
`DEFAULT_MUSIC_STEMS` to the Neutral/Standard variant, looping forever. The other 36 rendered
variants are unused, and the menu is silent.

Remaining work, in original terms:

- `Theme_*` maps (types 2-5) switch between `Friendly`/`Neutral`/`Hostile` with the local player's
  diplomatic state. Blocked on the diplomacy branch landing on `main`.
- `Mission_*` maps switch between `Standard`/`Wealthy`/`Danger`. The original's trigger thresholds
  live only in `Game.exe` and are unknown; any prosperity/threat heuristic is an approximation and
  must be named as one.
- `Attack_<tribe>` (types 6-9) plays during combat. Selection basis (whose tribe, which fights)
  needs evidence before implementing.
- The main menu plays type 2 (`Theme_Viking_*`) - `StartTrack(2)` hardcoded in `Game.exe`. Needs a
  music-capable driver in the menu entry, which today has no audio at all.

The seam is ready: all 64 variants are rendered into `content/music/`, the manifest carries their
loop points, and `WebAudioEngine.setMusic` crossfades on any track change. The mood decision should
live in the pure audio director (per-frame, from snapshot state), not in app control flow.

Verification: acceptance scene or headless check per mood transition, plus a human listening pass.
