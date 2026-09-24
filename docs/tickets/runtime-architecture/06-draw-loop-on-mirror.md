# Draw the mirror and interpolate it, with the shortfall visible in the HUD

**Area:** app, render · **Focus:** view/runtime/frame-loop, system-menu · **Priority:** P2
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md), [04 Sim worker host](04-sim-worker-host.md)

`startFrameLoop` steps the driver, takes the snapshot, then draws. Once the worker owns the ticks the
loop has nothing to step, and the interpolation alpha can no longer come from the driver's
accumulator. The player also has no signal today that the session runs below the requested speed
except the debug overlay, and once the stutter that used to signal it is gone, a slow session would
look like a normal one.

## Scope

- The frame loop reads the latest mirror snapshot and events, computes the render alpha from the
  worker's reported tick times against the main thread's clock, and keeps the fps cap and the
  per-frame order the loop pins today (camera, HUD, controls, render, hover, audio).
- `FrameStats` records receive time instead of sim and snapshot time, and keeps the `steps` split of
  00 as ticks received per frame.
- The in-game system menu (`packages/app/src/view/system-menu.ts`, which already carries the
  multiplayer status from `view/net/net-status.ts`) shows delivered speed against the requested one
  while a sustained shortfall holds, in single-player and relayed sessions alike.

## Verify

- Motion under a paused worker holds at the last alpha, as the driver does today.
- A scripted slow worker (an injected per-tick delay) produces the shortfall line within the
  reporting window and clears it when the delay is removed.
- Screenshots of the acceptance scenes unchanged.
- `npm test`, `npm run check`, `npm run build`.
