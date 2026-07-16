# Consolidate the sprite-pool ↔ portrait-cutout seam

**Area:** render · **Origin:** code review of branch fix/settler-drop-and-hud-fixes, 2026-07-16 · **Priority:** P3

The `fix/settler-drop-and-hud-fixes` branch taught `SpritePool` the details-panel portrait's
force-draw + solo-render bookkeeping. `PortraitInsetLayer.draw` now drives it through six public pool
methods — `showPortraitSubject`, `hidePortraitSubject`, `portraitSubjectContainer`,
`portraitSubjectIsIndoor`, `beginPortraitSolo`, `endPortraitSolo` — plus its own save/restore of
`worldLayer.children` visibility. It works and stays inside `render`, but the generic retained pool now
mixes per-frame reconcile with a specific HUD-cutout concern, and `PortraitInsetLayer` reaches deep into
pool internals (tight coupling). This is a readability/ownership cleanup, not a behavior change — do it
only behind green tests (the branch added `sprite-pool.test.ts` "details-panel portrait subject
visibility" + `collect-sprite-scene.test.ts` portrait tags).

## Scope

- Collapse the six pokes into one seam — e.g. `pool.withPortraitSubjectRevealed(worldLayer, indoor, fn)`
  that reveals the subject, (for indoor) blanks the world's other layers + solos the sprite layer, runs
  `fn` (the caller's `renderer.render`), and restores everything in a `finally`. Keep the render call
  owned by `PortraitInsetLayer` (it owns the texture); the pool owns only the visibility bookkeeping.
- Remove the per-frame allocations on the open-portrait path: `PortraitInsetLayer.draw`'s
  `worldLayer.children.map(...)` (one array + N objects per indoor-portrait frame) and the
  `portraitSolo` push loop — reuse scratch arrays. Bounded to one open portrait, so this is grain, not a
  scale bug.
- Preserve the exact current behavior: subject force-drawn through the cull, hidden on the main map,
  indoor subject rendered alone on a transparent cutout, all toggles restored even if the render throws.

## Verify

`npm run build`, `npm test` (the pool + scene portrait tests must stay green). Human sign-off seam:
`npm run dev` → select a settler, pan away and send him into a building; confirm the portrait behaves
exactly as before (always shows him; indoor = still standing pose with no backdrop).
