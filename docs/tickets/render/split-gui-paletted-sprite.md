# Split the GUI chrome pipeline out of PalettedSprite

**Area:** render (gpu/paletted-sprite) · **Priority:** P3

`PalettedSprite` is the world team-colour mesh for characters (its own doc says to keep it to
characters; the sprite pool uses only `setFrame`, `place`, `player`). App HUD code has since
bolted on `colorKey`, `silhouette`, `flipY`, and `stretchToRect`, all driven from
`packages/app/src/hud/**` and `content/gui-art.ts`. Two concrete accretion symptoms:

- `GuiColorKey` packs a geometric disc clip into the colour-key uniform slot (shader comment:
  ".y: near-black mode (0 off / 1 full band / 2 round corners)", with a `length(...) > 1.0 →
  discard` branch), a shape mode wedged into a colour flag.
- `stretchToRect` invalidates the `setFrame` memo by poking the private cache key
  (`this.lastAtlasW = -1; // bust the setFrame memo`).

Every world character pays the GUI fragment branches, and the class doc already warns paletted
meshes bypass batching.

## Scope

- A separate `GuiPalettedSprite` (own shader program) carrying the key/silhouette/clip/stretch
  features; the world class keeps only frame/place/player.
- Give the round-corner clip its own named uniform instead of colour-key mode 2, and replace the
  `lastAtlasW` poke with an explicit invalidation method.
- Non-goal: any visual change; both sprites must render pixel-identically to today.

## Verify

`npm test`, `npm run check`, `npm run build`. Human seam: compare tool panel buttons, details
panel chrome, bitmap text, and in-world settler team colours in `?scene=sandbox` before/after;
pixels must match.
