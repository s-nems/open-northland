# Re-derive the HUD scale and camera frame when the viewport changes

**Area:** app · **Priority:** P2

`startGameView` computes `uiscale` once from `app.screen.height` and hands the number to the tool
panel, minimap, unit controls and perf overlay; the opening camera is framed once from
`app.screen.width/height` in both playable entries. Nothing in the game runtime listens for `resize`
or `fullscreenchange`, so a viewport that grows mid-match keeps the launch-time scale and the
launch-time frame for the rest of the session, with no in-game control to correct either.

Restoring a stored fullscreen makes this reachable on a normal path: the match document always boots
windowed and enters fullscreen on the session's first gesture, after both reads. On a 1200x800 window
filling a 1440p display the HUD stays near 0.91x where the viewport calls for 1.88x, and the settlement
the entry framed at the window's centre sits in the upper-left quadrant. Plain window resizing has
always had the same gap.

- Give the HUD a scale seam the runtime can drive, so a viewport change rebuilds or rescales the
  mounted controls instead of requiring a reload. `?uiscale` must keep pinning an absolute value.
- Pan the camera by half the size delta on a viewport change, so the world point at the centre stays
  at the centre.

## Scope

- `packages/app/src/view/runtime/game-view.ts`, the HUD mounts that take `uiscale`
  (`hud/tool-panel`, `hud/minimap`, `view/unit-controls`, `view/perf-overlay`), and the initial
  camera in `packages/app/src/entries/map.ts` and `entries/scene.ts`.
- Out of scope: `view/fullscreen.ts`. The restore needs no change once the runtime reacts to a
  viewport change.

## Verify

- Unit: a scale seam driven from a changed viewport height reports the value `uiScaleFor` gives for
  that height, and the camera recentre keeps a chosen world point at the viewport centre.
- Human pass: take the menu's fullscreen prompt, launch `?map=` in a small window on a large display,
  click once to let the stored mode return, and confirm the panels match a session that started
  fullscreen and that the settlement stays centred.
