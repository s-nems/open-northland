# Decide who owns the text-HUD stack — render or the `?shot` entry

**Area:** render, app · **Origin:** /refactor-cleanup on packages/render, 2026-07-17 · **Priority:** P3
**Needs user:** an ownership judgement call, not a mechanical cleanup — decide (a) or (b) below.

render ships a complete text-HUD stack whose consumers split cleanly in two:

- **The real game HUD uses only the pure half.** `buildHud` + `layoutHud` → `HudLayout` is consumed by
  `app/src/view/projections/snapshot-projections.ts` and then by app's own tool panel. That half is a
  pure snapshot projection and clearly belongs in render.
- **The place + draw half serves exactly one caller: `packages/app/src/entries/shot.ts`.** `placeHud`,
  `HudPlacement`, `HudScreen`, `HudCorner`, and the whole Pixi layer behind them
  (`gpu/overlays/hud-layer.ts` — `HudLayer`, `HudFrame`, `HudStyle`, `DEFAULT_HUD_STYLE`), wired
  through `WorldFrame.hud` and drawn in `WorldRenderer.update`. Verified: `placeHud` has no other
  hit, and `WorldFrame.hud` is populated only at `shot.ts` (behind `?hud=0`). The live game never
  sets it — the actual game HUD is app-owned and unrelated (`app/src/hud/`: PalettedSprite bitmap
  text, tool panel, details panel, minimap).

So render carries a second, parallel HUD implementation — a Pixi `Text`/`Graphics` debug overlay with
its own style struct and glyph-churn optimization — to serve one screenshot entry, while the package's
`AGENTS.md` frames render as terrain + sprites + cull. Nothing says `WorldFrame.hud` is the shot
harness's overlay rather than the game's HUD seam, which is exactly how it reads today.

This is a judgement call, not a defect: `?shot` is a load-bearing harness (docs/TESTING.md) and needs
*some* deterministic overlay, and `HudLayer` is small and retained-correct.

## Scope

Pick one:

**(a) Move the place+draw half to the shot entry.** app already owns Pixi and its own HUD rendering.
Deletes `gpu/overlays/hud-layer.ts` + its test, drops `WorldFrame.hud` and `placeHud`/`HudPlacement`/
`HudScreen`/`HudCorner` from render's barrel (7 symbols), trims `data/hud/`. `data/hud/place.ts` goes
with it, leaving `data/hud/{model,layout}.ts`.

**(b) Keep it and say so.** Document in `packages/render/AGENTS.md` that `HudLayer`/`WorldFrame.hud`
is the deterministic `?shot` overlay, not the game HUD, and name the app-owned HUD as the real one.

## Verify

Either way: `npm test`, `npm run check`, `npm run build`. For (a), the gate that matters is a `?shot`
byte-comparison — the capture must be pixel-identical before and after the move, since the whole point
is that nothing about the drawn overlay changes.
