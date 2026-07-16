# Draw the portrait cutout's terrain backdrop when the subject is off-screen

**Area:** render · **Origin:** branch fix/settler-drop-and-hud-fixes, 2026-07-16 · **Priority:** P3

The details-panel portrait re-renders the world cutout (`PortraitInsetLayer.draw`) aimed at the
selected entity, sharing the renderer's `worldLayer` (terrain chunks + the sprite pool). The
`fix/settler-drop-and-hud-fixes` branch made the portrait *subject* force-drawn through the viewport
cull (see `sprite-scene.ts` `portraitRef`), so the settler always shows — but the **terrain chunks**
are still culled to the MAIN viewport (`WorldRenderer.update` → `this.terrain.cull(vp)`). When the
subject is panned far off-screen, the chunk under it is `visible = false`, so the cutout draws the
settler over transparent, which composites over the panel's parchment preview box. That reads fine
(the settler is clearly shown), so this is polish, not a defect — the common cases (subject on/near
screen, or an indoor subject at its on-screen workplace) already show terrain.

Source basis: observed behavior of this renderer; the original's portrait backdrop fidelity is not a
pinned reference, so the target is "cutout shows the ground under the subject", not a byte match.

## Scope

Give the portrait's second render the terrain (and ideally nearby statics) under an off-screen
subject without un-culling the whole map:

- Compute the inset camera's world box in `PortraitInsetLayer.draw` and temporarily mark the terrain
  chunks it overlaps `visible = true` for that render, restoring after — mirroring how the sprite
  pool reveals/hides the subject (`showPortraitSubject`/`hidePortraitSubject`).
- Keep it O(chunks-in-inset), not O(map); only runs while a portrait is open.
- Decide whether nearby map objects/other sprites should also appear (currently only the forced
  subject is guaranteed); scope this to terrain first if statics add complexity.

## Verify

`npm run build`, `npm test`. Human sign-off seam: `npm run dev` → select a settler, pan the camera
far away, confirm the portrait shows the settler on ground rather than the bare panel background;
confirm no regression when the subject is on-screen or inside a building.
