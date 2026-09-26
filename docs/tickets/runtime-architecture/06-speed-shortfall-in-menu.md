# Show the player a sustained speed shortfall in the system menu

**Area:** app · **Focus:** diag/frame-stats, system-menu · **Priority:** P2
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md)

The frame loop already draws the mirror and interpolates by the tick arrival time, so a slow session
no longer stutters, and nothing tells the player it runs below the requested speed. The only signal is
the debug perf overlay, and it misses the worker host: `FrameStats` raises `sustainedShortfall` only
when two consecutive windows dropped ticks, while the `?map=` worker holds its clock instead of
dropping ticks when the main thread falls behind. There the shortfall shows only as
`recent.deliveredSpeed` below the requested speed.

## Scope

- Judge a sustained shortfall on delivered against requested speed over consecutive windows, so it
  holds for dropped ticks and for a held worker clock alike, and a single hitch such as a map load
  still does not raise it.
- The in-game system menu (`packages/app/src/view/system-menu.ts`, which already carries the
  multiplayer status from `view/net/net-status.ts`) shows delivered speed against the requested one
  while a sustained shortfall holds, in single-player and relayed sessions alike. Localize the line.

## Verify

- A unit test on `FrameStats`: a delivered speed held below the request raises the shortfall with no
  dropped ticks, one slow window does not.
- A scripted slow worker (an injected per-tick delay) and a scripted slow main thread (a per-frame
  busy loop) each produce the shortfall line within the reporting window and clear it when the delay
  is removed.
- Screenshots of the acceptance scenes unchanged.
- `npm test`, `npm run check`, `npm run build`.
