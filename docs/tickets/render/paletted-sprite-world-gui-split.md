# Split PalettedSprite's world vs. GUI concerns

**Area:** render, app · **Origin:** /refactor-cleanup on packages/render, 2026-07-12

`gpu/paletted-sprite/paletted-sprite.ts` (the `PalettedSprite` class, ~273 lines;
its GL program now lives in the sibling `gpu/paletted-sprite/shader.ts`) still
serves two unrelated domains in one class and one shader program:

- **World settler rendering** — `place`, `setFrame`, `player`, `artScale` — the team-
  colour LUT mesh, used by `gpu/sprite-pool/sprite-pool.ts`.
- **GUI/HUD chrome** — `colorKey`/`GuiColorKey`, `silhouette`, `stretchToRect`,
  `flipY` — whose only callers are in `packages/app` (`content/{gui-gfx,gui-art,
  font-gfx,goods-gfx,sprite-sheet}.ts`, `hud/{icon-texture,tool-panel/strip-outline,
  details-panel/panel}.ts`, `view/settler-actions.ts`, `catalog/roster.ts`). The
  fragment shader bakes BOTH the world palette-LUT path and the GUI color-key /
  silhouette branches into one program.

Splitting a lean world `PalettedSprite` from a `GuiPalettedSprite` (or a mixin)
keeps the core world mesh from being sized by HUD needs. Deferred from the render
pass because it is a WIDE, cross-package change (~10 app files) and touches the
shader — a **visual-risk** change that needs a human GPU check, so it does not
belong in a behavior-preserving cleanup.

## Scope

Separate the GUI keying/silhouette/stretch surface (and its shader branches) from
the world LUT path. Update the ~10 app callers to the GUI type. Keep the world mesh
shader minimal. This changes shader source → **treat as visual**: capture before/
after screenshots of both a world scene (team-coloured settlers) and a HUD scene.

## Verify

`npm run build`, `npm test`, `npm run check`. `npm run shot` of a gameplay scene AND
a HUD/catalog scene, compared before/after. Pixel/colour correctness on a real GPU is
the user's sign-off — do not self-certify the ramp remap or the silhouette.
