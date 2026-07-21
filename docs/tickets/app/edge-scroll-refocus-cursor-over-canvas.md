# Resume edge-scroll after refocus when the cursor is already over the canvas

**Area:** app (view/camera) · **Priority:** P3

`createCameraController` (`packages/app/src/view/camera/controller.ts`) enables the RTS screen-edge pan only while
`pointerInside` is true, and `pointerInside` flips true **only** on a `mouseenter` boundary crossing
(`onPointerEnter`); `onBlur` clears it. So if the player alt-tabs away and back with the cursor still
resting over the canvas, no `mouseenter` fires on return, and a plain `mousemove` does not set
`pointerInside` — edge-scroll stays dead until the cursor physically leaves the canvas and re-enters.

Observed by both reviewers on fix/camera-startup-edge-drift as a pre-existing quirk, distinct from the
top-left-drift bug that branch fixed (that fix added `pointerMoved` and neither caused nor worsened
this). Low impact — the player can nudge the cursor off-canvas and back — but it reads as unresponsive.

## Scope

- Re-arm `pointerInside` without requiring a boundary crossing: simplest is to set `pointerInside = true`
  inside `onMouseMove` when the sampled client point falls within the canvas `rect` (reuse
  `screenScale`'s `rect`), so a move after refocus re-enables the probe. Keep `mouseleave`/`onBlur`
  clearing it.
- Confirm this does not re-introduce panning from a stale position — `pointerMoved` already gates that,
  and a `mousemove` supplies a real coordinate by definition.

## Verify

- `npm test`, `npm run check`, `npm run build`.
- Human browser pass (the DOM controller is human-gated): `npm run dev` → a scene, alt-tab away and back
  with the cursor left resting inside the canvas, move the mouse to an edge, and confirm edge-scroll
  resumes without first leaving and re-entering the canvas.
