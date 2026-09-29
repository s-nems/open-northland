# Give the byzantine spearman and hero a base palette

**Area:** pipeline, render · **Focus:** human palettes · **Priority:** P3

The byzantine spearman (`cr_hum_body_72`, tribe 3 job 32) and hero (`cr_hum_body_73`, job 42) records
name no `gfxpalettebasebody`, only `gfxpaletterandom "grizzu"` / `"grizzu_small"`. Both names are
`[RandomPalette]` recipes that patch bands 1-6, 8, 11 and 15 from the `grizzu N` ramps, so the
`humanPalettes` lane already carries them. Original behavior: bases come only from
`gfxpalettebase*` lines, so these records start from no base, and which colours the untouched bands
(0, 7, 9, 10, 12-14) show in the running original is unconfirmed.

The pipeline binds their body atlas through the `test_human_00` floor (`jobBaseGraphicsToBindings`),
and the `bases` lane has no entry for them. `grizzu` is also a `[GfxPalette256]` (`grizzu.pcx`), a
plausible authored skin.

## Scope

- Compare the two bodies in the running original against `test_human_00` and `grizzu.pcx` as base.
- Name the chosen base for these records in the pipeline (an approximation unless confirmed) and emit
  it into `humanPalettes.bases` and the records' `bodyPalette`.

## Verify

- A pipeline test over a synthetic record with no base and a `grizzu`-style recipe.
- Human pass on a byzantine map: the spearman and hero wear the chosen skin - **user's eyes**.
