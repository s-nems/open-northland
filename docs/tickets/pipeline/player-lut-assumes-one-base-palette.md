# Compose the player-colour LUT from every base palette a human record names

**Area:** pipeline, render, app · **Focus:** player colours · **Priority:** P2

`convertPlayerColorLut` builds every row of `player-lut.png` from one base palette,
`test_human_00.pcx`, and the indexed character atlases store a raw palette index in red. A body or head
whose `[jobbasegraphics]` record names a different `gfxpalettebase*` is therefore drawn through the
wrong colour table whenever the LUT is present, which is the normal path.

Five looks are affected, all of them non-viking, measured against the owned copy's
`palettes/creatures/*.pcx` trailers:

| bob | records | authored palette | entries differing from the LUT base |
| --- | --- | --- | --- |
| `cr_hum_body_78` | egypt jobs 31/32/33 | `egypt_soldier` | 159 of 256 |
| `cr_hum_body_79` | egypt jobs 34/35 | `egypt_soldier` | 159 of 256 |
| `cr_hum_head_42`, `cr_hum_head_43` | egypt jobs 40/41 | `egypt_soldier` | 159 of 256 |
| `cr_hum_head_33` | frank jobs 32/33 | `human_special` (`special.pcx`) | 256 of 256 |

The pipeline already emits each of these in its authored skin (`cr_hum_body_78.egypt_soldier.png`), so
the art is decoded; only the recolourable path is wrong. The same single-palette assumption drops two
more looks earlier: `jobBaseGraphicsToBindings` skips a body slot whose record carries no
`gfxpalettebasebody`, and the byzantine spearman (`cr_hum_body_72`, job 32) and hero
(`cr_hum_body_73`, job 42) name only `gfxpaletterandom "grizzu"`. Both `.bmd`s ship, and `grizzu` is a
real `[GfxPalette256]`, so those two draw the plain soldier body today.

The repo already records the failure mode for a neighbouring case: `convertGuidepostPlayerAtlases`
bakes per player rather than indexing, "because the LUT rows carry composed human palettes, which
differ from it at every index the guidepost draws".

## Scope

- Compose one LUT block per distinct base palette the human `[jobbasegraphics]` records name, keeping
  the existing `(armor tier, player)` layout inside each block, and carry the block order to the app so
  a character resolves its own. `buildPaletteLutImage` already takes an ordered row list.
- Give the render's `paletteLutRow` the block term and let a settler character name its block.
- Fall back to `gfxpaletterandom` when a record names no base palette, so the two byzantine bodies
  bind at all; confirm against the running original that `grizzu` is the skin they wear.

## Verify

- Pipeline test over a synthetic two-palette binding set: the LUT carries both blocks and the reported
  order matches the rows.
- `npm run test:pipeline`, then a real-content assertion that every palette a `jobGraphics` record
  names has a block.
- Human pass on `?map=arabskie_wyspy_wolna_gra_mieszana`: an egyptian soldier and a frank spearman must
  wear their own colours, and a second player of the same tribe must still be told apart by the team
  band - **user's eyes**.
