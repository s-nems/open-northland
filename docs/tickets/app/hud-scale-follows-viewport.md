# Re-derive the HUD scale and camera frame when the viewport changes

**Area:** app · **Priority:** P2

`startGameView` computes `uiscale` once from `app.screen.height` and hands the number to the tool
panel, minimap, unit controls and perf overlay; the opening camera is framed once from
`app.screen.width/height` in both playable entries. Nothing in the game runtime listens for `resize`
or `fullscreenchange`, so a viewport that grows mid-match keeps the launch-time scale and the
launch-time frame for the rest of the session, with no in-game control to correct either.

A menu launch now hands over in-document, so the scale is sampled in the mode the player is already
in. What is left is every other way the viewport moves: a `?map=` link or a reload boots windowed and
takes a stored fullscreen back on the first gesture, after both reads; plain window resizing and a
monitor change have always had the same gap. On a 900x533 window filling a 3440x1440 display the HUD
stays at the `MIN_UI_SCALE` floor where the viewport calls for `MAX_UI_SCALE_BASE`, and the
settlement framed at the window's centre sits in the upper-left quadrant.

- Give the HUD a scale seam the runtime can drive, so a viewport change rebuilds or rescales the
  mounted controls instead of requiring a reload. `?uiscale` must keep pinning an absolute value.
- Pan the camera by half the size delta on a viewport change, so the world point at the centre stays
  at the centre.

## Scope

- `packages/app/src/view/runtime/game-view.ts`, the HUD mounts that take `uiscale`
  (`hud/tool-panel`, `hud/minimap`, `view/unit-controls`, `view/perf-overlay`), and the initial
  camera in `packages/app/src/entries/map.ts` and `entries/scene.ts`.
- The seam is wider than the four mount calls: `PanelContext` hands `layout` and `scale` to every
  tool-panel sub-controller, `createStripSurface` bakes a texture for one scale, and `frame-loop.ts`
  captures the mounts by value. `hud/minimap` already re-reads `app.screen.height` per layout and is
  the cheap half.
- Out of scope: `view/fullscreen.ts`. The restore needs no change once the runtime reacts to a
  viewport change.

## Verify

- Unit: a scale seam driven from a changed viewport height reports the value `uiScaleFor` gives for
  that height, and the camera recentre keeps a chosen world point at the viewport centre.
- Human pass: launch `?map=` in a small window on a large display with a stored fullscreen, click
  once to let the mode return, and confirm the panels match a session that started fullscreen and
  that the settlement stays centred.
